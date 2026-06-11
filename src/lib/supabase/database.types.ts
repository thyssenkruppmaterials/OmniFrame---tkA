// Created and developed by Jai Singh
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'access_requests_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'access_requests_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'access_requests_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'access_requests_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'access_requests_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'access_requests_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'access_requests_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      agent_service_keys: {
        Row: {
          agent_id: string
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          label: string | null
          last_used_at: string | null
          organization_id: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          label?: string | null
          last_used_at?: string | null
          organization_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          label?: string | null
          last_used_at?: string | null
          organization_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'agent_service_keys_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'agent_service_keys_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'agent_service_keys_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_service_keys_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'agent_service_keys_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_service_keys_revoked_by_fkey'
            columns: ['revoked_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'agent_service_keys_revoked_by_fkey'
            columns: ['revoked_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'agent_service_keys_revoked_by_fkey'
            columns: ['revoked_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_service_keys_revoked_by_fkey'
            columns: ['revoked_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      agent_triggers: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          id: string
          match_filter: Json
          name: string
          organization_id: string
          payload_template: Json
          post_success_patch: Json | null
          source_events: string[]
          source_table: string
          target_endpoint: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          match_filter?: Json
          name: string
          organization_id: string
          payload_template?: Json
          post_success_patch?: Json | null
          source_events: string[]
          source_table: string
          target_endpoint: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          match_filter?: Json
          name?: string
          organization_id?: string
          payload_template?: Json
          post_success_patch?: Json | null
          source_events?: string[]
          source_table?: string
          target_endpoint?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agent_triggers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'agent_triggers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'agent_triggers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_triggers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'agent_triggers_organization_id_fkey'
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'applications_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'applications_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'applications_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'approval_workflows_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'approval_workflows_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'approval_workflows_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'audit_logs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'audit_logs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'audit_logs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      branches: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'branches_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      camera_devices: {
        Row: {
          category: string | null
          created_at: string | null
          exacq_camera_id: number
          format: number | null
          framerate: number | null
          id: string
          ip_address: unknown
          is_active: boolean | null
          is_ptz: boolean | null
          last_seen_at: string | null
          location: string | null
          mac_address: string | null
          model: string | null
          name: string
          organization_id: string
          resolution_height: number | null
          resolution_width: number | null
          stream_ids: Json | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          exacq_camera_id: number
          format?: number | null
          framerate?: number | null
          id?: string
          ip_address?: unknown
          is_active?: boolean | null
          is_ptz?: boolean | null
          last_seen_at?: string | null
          location?: string | null
          mac_address?: string | null
          model?: string | null
          name: string
          organization_id: string
          resolution_height?: number | null
          resolution_width?: number | null
          stream_ids?: Json | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          exacq_camera_id?: number
          format?: number | null
          framerate?: number | null
          id?: string
          ip_address?: unknown
          is_active?: boolean | null
          is_ptz?: boolean | null
          last_seen_at?: string | null
          location?: string | null
          mac_address?: string | null
          model?: string | null
          name?: string
          organization_id?: string
          resolution_height?: number | null
          resolution_width?: number | null
          stream_ids?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'camera_devices_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      camera_events: {
        Row: {
          acknowledged: boolean | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          camera_id: string
          created_at: string | null
          description: string | null
          event_type: string
          id: string
          metadata: Json | null
          organization_id: string
          severity: string | null
          snapshot_url: string | null
        }
        Insert: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          camera_id: string
          created_at?: string | null
          description?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          organization_id: string
          severity?: string | null
          snapshot_url?: string | null
        }
        Update: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          camera_id?: string
          created_at?: string | null
          description?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
          severity?: string | null
          snapshot_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'camera_events_camera_id_fkey'
            columns: ['camera_id']
            isOneToOne: false
            referencedRelation: 'camera_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'camera_events_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      camera_recordings: {
        Row: {
          camera_id: string
          created_at: string | null
          created_by: string | null
          duration_seconds: number | null
          end_time: string | null
          file_size_bytes: number | null
          id: string
          metadata: Json | null
          organization_id: string
          recording_type: string
          recording_url: string | null
          start_time: string
          status: string | null
          thumbnail_url: string | null
        }
        Insert: {
          camera_id: string
          created_at?: string | null
          created_by?: string | null
          duration_seconds?: number | null
          end_time?: string | null
          file_size_bytes?: number | null
          id?: string
          metadata?: Json | null
          organization_id: string
          recording_type: string
          recording_url?: string | null
          start_time: string
          status?: string | null
          thumbnail_url?: string | null
        }
        Update: {
          camera_id?: string
          created_at?: string | null
          created_by?: string | null
          duration_seconds?: number | null
          end_time?: string | null
          file_size_bytes?: number | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          recording_type?: string
          recording_url?: string | null
          start_time?: string
          status?: string | null
          thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'camera_recordings_camera_id_fkey'
            columns: ['camera_id']
            isOneToOne: false
            referencedRelation: 'camera_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'camera_recordings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      camera_user_preferences: {
        Row: {
          alert_preferences: Json | null
          created_at: string | null
          default_camera_id: string | null
          favorite_cameras: string[] | null
          grid_layout: string | null
          id: string
          organization_id: string
          preferred_quality: number | null
          preferred_resolution: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          alert_preferences?: Json | null
          created_at?: string | null
          default_camera_id?: string | null
          favorite_cameras?: string[] | null
          grid_layout?: string | null
          id?: string
          organization_id: string
          preferred_quality?: number | null
          preferred_resolution?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          alert_preferences?: Json | null
          created_at?: string | null
          default_camera_id?: string | null
          favorite_cameras?: string[] | null
          grid_layout?: string | null
          id?: string
          organization_id?: string
          preferred_quality?: number | null
          preferred_resolution?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'camera_user_preferences_default_camera_id_fkey'
            columns: ['default_camera_id']
            isOneToOne: false
            referencedRelation: 'camera_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'camera_user_preferences_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'chats_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'chats_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chats_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      cycle_count_assignment_history: {
        Row: {
          count_id: string
          created_at: string
          id: string
          new_counter_id: string
          new_counter_name: string | null
          organization_id: string
          previous_counted_quantity: number | null
          previous_counter_id: string | null
          previous_counter_name: string | null
          previous_status: string | null
          reassigned_at: string
          reassigned_by: string | null
        }
        Insert: {
          count_id: string
          created_at?: string
          id?: string
          new_counter_id: string
          new_counter_name?: string | null
          organization_id: string
          previous_counted_quantity?: number | null
          previous_counter_id?: string | null
          previous_counter_name?: string | null
          previous_status?: string | null
          reassigned_at?: string
          reassigned_by?: string | null
        }
        Update: {
          count_id?: string
          created_at?: string
          id?: string
          new_counter_id?: string
          new_counter_name?: string | null
          organization_id?: string
          previous_counted_quantity?: number | null
          previous_counter_id?: string | null
          previous_counter_name?: string | null
          previous_status?: string | null
          reassigned_at?: string
          reassigned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_assignment_history_count_id_fkey'
            columns: ['count_id']
            isOneToOne: false
            referencedRelation: 'rr_cyclecount_data'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_new_counter_id_fkey'
            columns: ['new_counter_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_new_counter_id_fkey'
            columns: ['new_counter_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_new_counter_id_fkey'
            columns: ['new_counter_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_new_counter_id_fkey'
            columns: ['new_counter_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_previous_counter_id_fkey'
            columns: ['previous_counter_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_previous_counter_id_fkey'
            columns: ['previous_counter_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_previous_counter_id_fkey'
            columns: ['previous_counter_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_previous_counter_id_fkey'
            columns: ['previous_counter_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_reassigned_by_fkey'
            columns: ['reassigned_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_reassigned_by_fkey'
            columns: ['reassigned_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_reassigned_by_fkey'
            columns: ['reassigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_assignment_history_reassigned_by_fkey'
            columns: ['reassigned_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      cycle_count_location_resolution_rules: {
        Row: {
          aisle_template: string | null
          canonical_bin_template: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          priority: number
          regex_pattern: string
          sequence_template: string | null
          updated_at: string
          updated_by: string | null
          warehouse_code: string | null
          zone_template: string | null
        }
        Insert: {
          aisle_template?: string | null
          canonical_bin_template?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          priority?: number
          regex_pattern: string
          sequence_template?: string | null
          updated_at?: string
          updated_by?: string | null
          warehouse_code?: string | null
          zone_template?: string | null
        }
        Update: {
          aisle_template?: string | null
          canonical_bin_template?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          priority?: number
          regex_pattern?: string
          sequence_template?: string | null
          updated_at?: string
          updated_by?: string | null
          warehouse_code?: string | null
          zone_template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_location_resolution_rules_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_location_resolution_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_location_resolution_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_location_resolution_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_location_resolution_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      cycle_count_operator_deferred_counts: {
        Row: {
          cleared_at: string | null
          count_id: string
          created_at: string
          defer_reason: string | null
          deferred_at: string
          id: string
          is_active: boolean
          organization_id: string
          reactivated_at: string | null
          resume_priority: number
          times_deferred: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cleared_at?: string | null
          count_id: string
          created_at?: string
          defer_reason?: string | null
          deferred_at?: string
          id?: string
          is_active?: boolean
          organization_id: string
          reactivated_at?: string | null
          resume_priority?: number
          times_deferred?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cleared_at?: string | null
          count_id?: string
          created_at?: string
          defer_reason?: string | null
          deferred_at?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          reactivated_at?: string | null
          resume_priority?: number
          times_deferred?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_count_id_fkey'
            columns: ['count_id']
            isOneToOne: false
            referencedRelation: 'rr_cyclecount_data'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      cycle_count_path_rules: {
        Row: {
          aisle_filter: string | null
          created_at: string
          direction: Database['public']['Enums']['path_direction']
          fallback_behavior: Database['public']['Enums']['path_fallback_behavior']
          id: string
          is_active: boolean
          max_counters_per_aisle: number
          organization_id: string
          priority: number
          strategy: Database['public']['Enums']['path_strategy']
          updated_at: string
          updated_by: string | null
          warehouse_code: string | null
          zone_filter: string | null
        }
        Insert: {
          aisle_filter?: string | null
          created_at?: string
          direction?: Database['public']['Enums']['path_direction']
          fallback_behavior?: Database['public']['Enums']['path_fallback_behavior']
          id?: string
          is_active?: boolean
          max_counters_per_aisle?: number
          organization_id: string
          priority?: number
          strategy?: Database['public']['Enums']['path_strategy']
          updated_at?: string
          updated_by?: string | null
          warehouse_code?: string | null
          zone_filter?: string | null
        }
        Update: {
          aisle_filter?: string | null
          created_at?: string
          direction?: Database['public']['Enums']['path_direction']
          fallback_behavior?: Database['public']['Enums']['path_fallback_behavior']
          id?: string
          is_active?: boolean
          max_counters_per_aisle?: number
          organization_id?: string
          priority?: number
          strategy?: Database['public']['Enums']['path_strategy']
          updated_at?: string
          updated_by?: string | null
          warehouse_code?: string | null
          zone_filter?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_path_rules_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_path_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_path_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_path_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_path_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      cycle_count_priority_rules: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          match_age_gte_hours: number | null
          match_count_type: string | null
          match_requires_recount: boolean | null
          match_variance_gte_pct: number | null
          match_warehouse: string | null
          match_zone: string | null
          name: string
          notes: string | null
          organization_id: string
          priority_level: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          match_age_gte_hours?: number | null
          match_count_type?: string | null
          match_requires_recount?: boolean | null
          match_variance_gte_pct?: number | null
          match_warehouse?: string | null
          match_zone?: string | null
          name: string
          notes?: string | null
          organization_id: string
          priority_level: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          match_age_gte_hours?: number | null
          match_count_type?: string | null
          match_requires_recount?: boolean | null
          match_variance_gte_pct?: number | null
          match_warehouse?: string | null
          match_zone?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          priority_level?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_priority_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_priority_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_priority_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_priority_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_priority_rules_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_priority_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_priority_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_priority_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_priority_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      cycle_count_zone_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          notes: string | null
          organization_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
          zone: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          notes?: string | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
          zone: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          notes?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_zone_assignments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      cycle_count_zone_rules: {
        Row: {
          bypass_count_types: string[]
          bypass_priorities: string[]
          created_at: string
          created_by: string | null
          enabled: boolean
          exclusion_pairs: Json
          notes: string | null
          organization_id: string
          policy: string
          sticky_zone: boolean
          supervisor_assignment_protection_hours: number
          treat_null_zone_as_locked: boolean
          updated_at: string
          updated_by: string | null
          zone_pattern: string | null
        }
        Insert: {
          bypass_count_types?: string[]
          bypass_priorities?: string[]
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          exclusion_pairs?: Json
          notes?: string | null
          organization_id: string
          policy?: string
          sticky_zone?: boolean
          supervisor_assignment_protection_hours?: number
          treat_null_zone_as_locked?: boolean
          updated_at?: string
          updated_by?: string | null
          zone_pattern?: string | null
        }
        Update: {
          bypass_count_types?: string[]
          bypass_priorities?: string[]
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          exclusion_pairs?: Json
          notes?: string | null
          organization_id?: string
          policy?: string
          sticky_zone?: boolean
          supervisor_assignment_protection_hours?: number
          treat_null_zone_as_locked?: boolean
          updated_at?: string
          updated_by?: string | null
          zone_pattern?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_zone_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_certifications_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_certifications_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_certifications_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_certifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_certifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_certifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_certifications_verified_by_fkey'
            columns: ['verified_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_certifications_verified_by_fkey'
            columns: ['verified_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_certifications_verified_by_fkey'
            columns: ['verified_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_certifications_verified_by_fkey'
            columns: ['verified_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_devices_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_devices_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_devices_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_devices_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_devices_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_devices_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      employee_reviews: {
        Row: {
          areas_for_improvement: string | null
          comments: string | null
          created_at: string | null
          employee_acknowledgment_at: string | null
          employee_comments: string | null
          employee_id: string
          goals: string | null
          id: string
          next_review_date: string | null
          organization_id: string
          overall_rating: number | null
          review_period_end: string
          review_period_start: string
          review_type: Database['public']['Enums']['review_type']
          reviewer_id: string
          status: Database['public']['Enums']['review_status']
          strengths: string | null
          updated_at: string | null
        }
        Insert: {
          areas_for_improvement?: string | null
          comments?: string | null
          created_at?: string | null
          employee_acknowledgment_at?: string | null
          employee_comments?: string | null
          employee_id: string
          goals?: string | null
          id?: string
          next_review_date?: string | null
          organization_id: string
          overall_rating?: number | null
          review_period_end: string
          review_period_start: string
          review_type?: Database['public']['Enums']['review_type']
          reviewer_id: string
          status?: Database['public']['Enums']['review_status']
          strengths?: string | null
          updated_at?: string | null
        }
        Update: {
          areas_for_improvement?: string | null
          comments?: string | null
          created_at?: string | null
          employee_acknowledgment_at?: string | null
          employee_comments?: string | null
          employee_id?: string
          goals?: string | null
          id?: string
          next_review_date?: string | null
          organization_id?: string
          overall_rating?: number | null
          review_period_end?: string
          review_period_start?: string
          review_type?: Database['public']['Enums']['review_type']
          reviewer_id?: string
          status?: Database['public']['Enums']['review_status']
          strengths?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'employee_reviews_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_reviews_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_reviews_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_reviews_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_reviews_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_reviews_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_reviews_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'employee_reviews_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_reviews_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'enhanced_user_sessions_user_id_fkey_user_profiles'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'enhanced_user_sessions_user_id_fkey_user_profiles'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'enhanced_user_sessions_user_id_fkey_user_profiles'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'external_customer_profiles_account_manager_id_fkey'
            columns: ['account_manager_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'external_customer_profiles_account_manager_id_fkey'
            columns: ['account_manager_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'external_customer_profiles_account_manager_id_fkey'
            columns: ['account_manager_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'external_customer_profiles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'external_customer_profiles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'external_customer_profiles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'external_customer_profiles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'files_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'files_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      inbound_cart_assignments: {
        Row: {
          cart_id: string
          clear_reason: string | null
          cleared_at: string | null
          cleared_by: string | null
          cleared_putaway_operation_id: string | null
          created_at: string
          id: string
          material_number: string
          organization_id: string
          raw_to_number: string
          status: string
          stowed_at: string
          stowed_by: string
          to_location: string | null
          to_number: string
          updated_at: string
          warehouse: string | null
        }
        Insert: {
          cart_id: string
          clear_reason?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_putaway_operation_id?: string | null
          created_at?: string
          id?: string
          material_number: string
          organization_id: string
          raw_to_number: string
          status?: string
          stowed_at?: string
          stowed_by: string
          to_location?: string | null
          to_number: string
          updated_at?: string
          warehouse?: string | null
        }
        Update: {
          cart_id?: string
          clear_reason?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_putaway_operation_id?: string | null
          created_at?: string
          id?: string
          material_number?: string
          organization_id?: string
          raw_to_number?: string
          status?: string
          stowed_at?: string
          stowed_by?: string
          to_location?: string | null
          to_number?: string
          updated_at?: string
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inbound_cart_assignments_cart_id_fkey'
            columns: ['cart_id']
            isOneToOne: false
            referencedRelation: 'inbound_stow_carts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbound_cart_assignments_cleared_by_fkey'
            columns: ['cleared_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbound_cart_assignments_cleared_by_fkey'
            columns: ['cleared_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbound_cart_assignments_cleared_by_fkey'
            columns: ['cleared_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbound_cart_assignments_cleared_by_fkey'
            columns: ['cleared_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbound_cart_assignments_cleared_putaway_operation_id_fkey'
            columns: ['cleared_putaway_operation_id']
            isOneToOne: false
            referencedRelation: 'rf_putaway_operations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbound_cart_assignments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbound_cart_assignments_stowed_by_fkey'
            columns: ['stowed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbound_cart_assignments_stowed_by_fkey'
            columns: ['stowed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbound_cart_assignments_stowed_by_fkey'
            columns: ['stowed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbound_cart_assignments_stowed_by_fkey'
            columns: ['stowed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      inbound_stow_carts: {
        Row: {
          cart_number: string
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          max_capacity: number
          notes: string | null
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
          warehouse: string | null
          warehouse_zone: string | null
        }
        Insert: {
          cart_number: string
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          max_capacity?: number
          notes?: string | null
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          warehouse?: string | null
          warehouse_zone?: string | null
        }
        Update: {
          cart_number?: string
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          max_capacity?: number
          notes?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          warehouse?: string | null
          warehouse_zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inbound_stow_carts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbound_stow_carts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbound_stow_carts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbound_stow_carts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbound_stow_carts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbound_stow_carts_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbound_stow_carts_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inbound_stow_carts_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbound_stow_carts_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      inventory_adjustment_staging: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string | null
          extended_value: number | null
          id: string
          material: string
          organization_id: string
          plant: string | null
          storage_bin: string | null
          storage_location: string | null
          storage_type: string | null
          total_stock: number
          unit_value: number
          zmm60_raw: Json | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string | null
          extended_value?: number | null
          id?: string
          material: string
          organization_id: string
          plant?: string | null
          storage_bin?: string | null
          storage_location?: string | null
          storage_type?: string | null
          total_stock: number
          unit_value: number
          zmm60_raw?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string | null
          extended_value?: number | null
          id?: string
          material?: string
          organization_id?: string
          plant?: string | null
          storage_bin?: string | null
          storage_location?: string | null
          storage_type?: string | null
          total_stock?: number
          unit_value?: number
          zmm60_raw?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_adjustment_staging_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inventory_adjustment_staging_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inventory_adjustment_staging_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_adjustment_staging_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'inventory_adjustment_staging_organization_id_fkey'
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kb_articles_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kb_articles_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kb_articles_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kb_articles_last_reviewed_by_fkey'
            columns: ['last_reviewed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kb_articles_last_reviewed_by_fkey'
            columns: ['last_reviewed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kb_articles_last_reviewed_by_fkey'
            columns: ['last_reviewed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kb_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kb_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kb_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
          kit_serial_number: string | null
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
          kit_serial_number?: string | null
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
          kit_serial_number?: string | null
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_build_flags_cleared_by_user_fkey'
            columns: ['cleared_by_user']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_build_flags_cleared_by_user_fkey'
            columns: ['cleared_by_user']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_build_flags_cleared_by_user_fkey'
            columns: ['cleared_by_user']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_build_flags_set_by_user_fkey'
            columns: ['set_by_user']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_build_flags_set_by_user_fkey'
            columns: ['set_by_user']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_build_flags_set_by_user_fkey'
            columns: ['set_by_user']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_build_flags_set_by_user_fkey'
            columns: ['set_by_user']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      kit_definition_chains: {
        Row: {
          chain_description: string | null
          chain_name: string
          created_at: string
          created_by: string | null
          id: string
          link_type: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          chain_description?: string | null
          chain_name: string
          created_at?: string
          created_by?: string | null
          id?: string
          link_type?: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          chain_description?: string | null
          chain_name?: string
          created_at?: string
          created_by?: string | null
          id?: string
          link_type?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'kit_definition_chains_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_definition_chains_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_definition_chains_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_definition_chains_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_definition_chains_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_definition_chains_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_definition_chains_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_definition_chains_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_definition_chains_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      kit_definitions: {
        Row: {
          assembly_instructions: string | null
          chain_id: string | null
          chain_sequence_order: number | null
          charge_code: string | null
          created_at: string | null
          created_by: string | null
          default_kit_cart_color: string | null
          effective_date: string | null
          engine_program: string | null
          estimated_assembly_time_minutes: number | null
          id: string
          kit_category: string | null
          kit_container_type: string | null
          kit_description: string | null
          kit_name: string
          kit_number: string
          kit_type: string | null
          kit_version: string | null
          obsolete_date: string | null
          organization_id: string
          required_components: Json | null
          status: string | null
          total_components_count: number | null
          updated_at: string | null
          updated_by: string | null
          work_instructions_url: string | null
        }
        Insert: {
          assembly_instructions?: string | null
          chain_id?: string | null
          chain_sequence_order?: number | null
          charge_code?: string | null
          created_at?: string | null
          created_by?: string | null
          default_kit_cart_color?: string | null
          effective_date?: string | null
          engine_program?: string | null
          estimated_assembly_time_minutes?: number | null
          id?: string
          kit_category?: string | null
          kit_container_type?: string | null
          kit_description?: string | null
          kit_name: string
          kit_number: string
          kit_type?: string | null
          kit_version?: string | null
          obsolete_date?: string | null
          organization_id: string
          required_components?: Json | null
          status?: string | null
          total_components_count?: number | null
          updated_at?: string | null
          updated_by?: string | null
          work_instructions_url?: string | null
        }
        Update: {
          assembly_instructions?: string | null
          chain_id?: string | null
          chain_sequence_order?: number | null
          charge_code?: string | null
          created_at?: string | null
          created_by?: string | null
          default_kit_cart_color?: string | null
          effective_date?: string | null
          engine_program?: string | null
          estimated_assembly_time_minutes?: number | null
          id?: string
          kit_category?: string | null
          kit_container_type?: string | null
          kit_description?: string | null
          kit_name?: string
          kit_number?: string
          kit_type?: string | null
          kit_version?: string | null
          obsolete_date?: string | null
          organization_id?: string
          required_components?: Json | null
          status?: string | null
          total_components_count?: number | null
          updated_at?: string | null
          updated_by?: string | null
          work_instructions_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'kit_definitions_chain_id_fkey'
            columns: ['chain_id']
            isOneToOne: false
            referencedRelation: 'kit_definition_chains'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_definitions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_definitions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_definitions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_definitions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_definitions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_definitions_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_definitions_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_definitions_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_definitions_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      kit_notes: {
        Row: {
          body: string
          created_at: string
          event_kind: string | null
          id: string
          kit_serial_number: string
          organization_id: string
          sender_name: string | null
          sender_type: string
          sender_user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          event_kind?: string | null
          id?: string
          kit_serial_number: string
          organization_id: string
          sender_name?: string | null
          sender_type: string
          sender_user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          event_kind?: string | null
          id?: string
          kit_serial_number?: string
          organization_id?: string
          sender_name?: string | null
          sender_type?: string
          sender_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'kit_notes_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_notes_sender_user_id_fkey'
            columns: ['sender_user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_notes_sender_user_id_fkey'
            columns: ['sender_user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kit_notes_sender_user_id_fkey'
            columns: ['sender_user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_notes_sender_user_id_fkey'
            columns: ['sender_user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      kitting_dropdown_options: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          option_group: string
          option_label: string
          option_value: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          option_group: string
          option_label: string
          option_value: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          option_group?: string
          option_label?: string
          option_value?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'kitting_dropdown_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kitting_dropdown_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kitting_dropdown_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kitting_dropdown_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kitting_dropdown_options_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      kitting_workflow_settings: {
        Row: {
          black_hat_ship_short_authorization_enabled: boolean
          black_hat_ship_short_require_justification: boolean
          black_hat_ship_short_require_line_by_line_approval: boolean
          created_at: string
          deliver_to_plant_locations: string[]
          kit_inspection_required: boolean
          non_warehouse_bin_patterns: string[]
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          black_hat_ship_short_authorization_enabled?: boolean
          black_hat_ship_short_require_justification?: boolean
          black_hat_ship_short_require_line_by_line_approval?: boolean
          created_at?: string
          deliver_to_plant_locations?: string[]
          kit_inspection_required?: boolean
          non_warehouse_bin_patterns?: string[]
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          black_hat_ship_short_authorization_enabled?: boolean
          black_hat_ship_short_require_justification?: boolean
          black_hat_ship_short_require_line_by_line_approval?: boolean
          created_at?: string
          deliver_to_plant_locations?: string[]
          kit_inspection_required?: boolean
          non_warehouse_bin_patterns?: string[]
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'kitting_workflow_settings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kitting_workflow_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kitting_workflow_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'kitting_workflow_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kitting_workflow_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      label_assets: {
        Row: {
          bytes: number | null
          created_at: string
          created_by: string | null
          height: number | null
          id: string
          mime_type: string
          name: string
          organization_id: string
          storage_path: string
          width: number | null
        }
        Insert: {
          bytes?: number | null
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          mime_type: string
          name: string
          organization_id: string
          storage_path: string
          width?: number | null
        }
        Update: {
          bytes?: number | null
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          mime_type?: string
          name?: string
          organization_id?: string
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'label_assets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_assets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_assets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_assets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_assets_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      label_data_sources: {
        Row: {
          created_at: string
          created_by: string | null
          default_filters: Json
          description: string | null
          field_map: Json
          id: string
          kind: string
          name: string
          organization_id: string
          sample_row: Json | null
          target: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_filters?: Json
          description?: string | null
          field_map?: Json
          id?: string
          kind: string
          name: string
          organization_id: string
          sample_row?: Json | null
          target: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_filters?: Json
          description?: string | null
          field_map?: Json
          id?: string
          kind?: string
          name?: string
          organization_id?: string
          sample_row?: Json | null
          target?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'label_data_sources_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_data_sources_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_data_sources_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_data_sources_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_data_sources_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      label_print_history: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          payload: Json | null
          print_job_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          payload?: Json | null
          print_job_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          payload?: Json | null
          print_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'label_print_history_print_job_id_fkey'
            columns: ['print_job_id']
            isOneToOne: false
            referencedRelation: 'label_print_jobs'
            referencedColumns: ['id']
          },
        ]
      }
      label_print_jobs: {
        Row: {
          attempts: number
          copies: number
          created_at: string
          created_by: string | null
          data_payload: Json | null
          error: string | null
          id: string
          organization_id: string
          output_format: string
          output_uri: string | null
          printed_at: string | null
          printer_id: string | null
          row_count: number
          status: string
          template_id: string
        }
        Insert: {
          attempts?: number
          copies?: number
          created_at?: string
          created_by?: string | null
          data_payload?: Json | null
          error?: string | null
          id?: string
          organization_id: string
          output_format: string
          output_uri?: string | null
          printed_at?: string | null
          printer_id?: string | null
          row_count?: number
          status?: string
          template_id: string
        }
        Update: {
          attempts?: number
          copies?: number
          created_at?: string
          created_by?: string | null
          data_payload?: Json | null
          error?: string | null
          id?: string
          organization_id?: string
          output_format?: string
          output_uri?: string | null
          printed_at?: string | null
          printer_id?: string | null
          row_count?: number
          status?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'label_print_jobs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_print_jobs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_print_jobs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_print_jobs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_print_jobs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_print_jobs_printer_id_fkey'
            columns: ['printer_id']
            isOneToOne: false
            referencedRelation: 'label_printers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_print_jobs_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'label_templates'
            referencedColumns: ['id']
          },
        ]
      }
      label_printers: {
        Row: {
          bridge_endpoint: string | null
          created_at: string
          created_by: string | null
          default_for_template_id: string | null
          description: string | null
          dpi: number
          host: string | null
          id: string
          is_active: boolean
          media_size: string | null
          name: string
          organization_id: string
          port: number | null
          type: string
          updated_at: string
        }
        Insert: {
          bridge_endpoint?: string | null
          created_at?: string
          created_by?: string | null
          default_for_template_id?: string | null
          description?: string | null
          dpi?: number
          host?: string | null
          id?: string
          is_active?: boolean
          media_size?: string | null
          name: string
          organization_id: string
          port?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          bridge_endpoint?: string | null
          created_at?: string
          created_by?: string | null
          default_for_template_id?: string | null
          description?: string | null
          dpi?: number
          host?: string | null
          id?: string
          is_active?: boolean
          media_size?: string | null
          name?: string
          organization_id?: string
          port?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'label_printers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_printers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_printers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_printers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_printers_default_for_template_id_fkey'
            columns: ['default_for_template_id']
            isOneToOne: false
            referencedRelation: 'label_templates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_printers_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      label_template_categories: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          icon: string | null
          id: string
          name: string
          organization_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          name: string
          organization_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          name?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'label_template_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_template_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_template_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_template_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_template_categories_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      label_template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          layout: Json
          page_setup: Json
          template_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          layout: Json
          page_setup: Json
          template_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          layout?: Json
          page_setup?: Json
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'label_template_versions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_template_versions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_template_versions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_template_versions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_template_versions_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'label_templates'
            referencedColumns: ['id']
          },
        ]
      }
      label_templates: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          data_source_id: string | null
          description: string | null
          id: string
          is_published: boolean
          layout: Json
          name: string
          organization_id: string
          page_setup: Json
          thumbnail_url: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          data_source_id?: string | null
          description?: string | null
          id?: string
          is_published?: boolean
          layout?: Json
          name: string
          organization_id: string
          page_setup?: Json
          thumbnail_url?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          data_source_id?: string | null
          description?: string | null
          id?: string
          is_published?: boolean
          layout?: Json
          name?: string
          organization_id?: string
          page_setup?: Json
          thumbnail_url?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'label_templates_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'label_template_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_templates_data_source_fk'
            columns: ['data_source_id']
            isOneToOne: false
            referencedRelation: 'label_data_sources'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_templates_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'label_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'label_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'labor_standards_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'labor_standards_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'labor_standards_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      ll01_activity_snapshots: {
        Row: {
          agent_id: string | null
          category: string
          count: number
          duration_ms: number | null
          id: string
          organization_id: string
          plant: string
          ran_at: string
          snapshot_run_id: string
        }
        Insert: {
          agent_id?: string | null
          category: string
          count?: number
          duration_ms?: number | null
          id?: string
          organization_id: string
          plant: string
          ran_at?: string
          snapshot_run_id: string
        }
        Update: {
          agent_id?: string | null
          category?: string
          count?: number
          duration_ms?: number | null
          id?: string
          organization_id?: string
          plant?: string
          ran_at?: string
          snapshot_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'll01_activity_snapshots_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_agent_events: {
        Row: {
          created_at: string
          device_id: string
          event_type: string
          id: string
          payload: Json | null
          timestamp: string
        }
        Insert: {
          created_at?: string
          device_id: string
          event_type: string
          id?: string
          payload?: Json | null
          timestamp?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          event_type?: string
          id?: string
          payload?: Json | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_agent_events_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_apps: {
        Row: {
          blacklisted: boolean | null
          bundle_id: string
          created_at: string
          icon_url: string | null
          id: string
          managed: boolean | null
          name: string
          organization_id: string
          updated_at: string
          version: string | null
          vpp_license_count: number | null
          vpp_licenses_used: number | null
        }
        Insert: {
          blacklisted?: boolean | null
          bundle_id: string
          created_at?: string
          icon_url?: string | null
          id?: string
          managed?: boolean | null
          name: string
          organization_id: string
          updated_at?: string
          version?: string | null
          vpp_license_count?: number | null
          vpp_licenses_used?: number | null
        }
        Update: {
          blacklisted?: boolean | null
          bundle_id?: string
          created_at?: string
          icon_url?: string | null
          id?: string
          managed?: boolean | null
          name?: string
          organization_id?: string
          updated_at?: string
          version?: string | null
          vpp_license_count?: number | null
          vpp_licenses_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_apps_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_checkin_events: {
        Row: {
          created_at: string
          device_id: string
          id: string
          ip_address: unknown
          message_type: string
          raw_payload: Json | null
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          ip_address?: unknown
          message_type: string
          raw_payload?: Json | null
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          ip_address?: unknown
          message_type?: string
          raw_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_checkin_events_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_command_approvals: {
        Row: {
          approved_by: string | null
          command_id: string
          id: string
          reason: string | null
          requested_at: string
          requested_by: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          approved_by?: string | null
          command_id: string
          id?: string
          reason?: string | null
          requested_at?: string
          requested_by: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          approved_by?: string | null
          command_id?: string
          id?: string
          reason?: string | null
          requested_at?: string
          requested_by?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_command_approvals_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_approvals_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_approvals_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_command_approvals_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_approvals_command_id_fkey'
            columns: ['command_id']
            isOneToOne: true
            referencedRelation: 'mdm_commands'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_command_approvals_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_approvals_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_approvals_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_command_approvals_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      mdm_command_events: {
        Row: {
          actor_id: string | null
          actor_type: string | null
          command_id: string
          correlation_id: string | null
          created_at: string
          event_type: string
          id: string
          ip_address: unknown
          new_status: string | null
          payload: Json | null
          previous_status: string | null
          user_agent: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string | null
          command_id: string
          correlation_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          ip_address?: unknown
          new_status?: string | null
          payload?: Json | null
          previous_status?: string | null
          user_agent?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string | null
          command_id?: string
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: unknown
          new_status?: string | null
          payload?: Json | null
          previous_status?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_command_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_command_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_events_command_id_fkey'
            columns: ['command_id']
            isOneToOne: false
            referencedRelation: 'mdm_commands'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_command_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          steps: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          steps: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_command_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_command_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_command_templates_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_commands: {
        Row: {
          acknowledged_at: string | null
          command_type: string
          command_uuid: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          device_id: string
          error_code: string | null
          error_message: string | null
          expires_at: string | null
          id: string
          idempotency_key: string | null
          initiated_by: string | null
          max_retries: number
          organization_id: string
          payload: Json | null
          payload_hash: string | null
          pipeline_id: string | null
          pipeline_step: number | null
          priority: number
          queued_at: string
          response_payload: Json | null
          retry_count: number
          scheduled_at: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          command_type: string
          command_uuid?: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          device_id: string
          error_code?: string | null
          error_message?: string | null
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          initiated_by?: string | null
          max_retries?: number
          organization_id: string
          payload?: Json | null
          payload_hash?: string | null
          pipeline_id?: string | null
          pipeline_step?: number | null
          priority?: number
          queued_at?: string
          response_payload?: Json | null
          retry_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          acknowledged_at?: string | null
          command_type?: string
          command_uuid?: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          device_id?: string
          error_code?: string | null
          error_message?: string | null
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          initiated_by?: string | null
          max_retries?: number
          organization_id?: string
          payload?: Json | null
          payload_hash?: string | null
          pipeline_id?: string | null
          pipeline_step?: number | null
          priority?: number
          queued_at?: string
          response_payload?: Json | null
          retry_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_commands_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_commands_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_commands_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_commands_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_commands_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_commands_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_compliance_policies: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          id: string
          name: string
          organization_id: string
          remediation_action: string | null
          rules: Json
          severity: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          name: string
          organization_id: string
          remediation_action?: string | null
          rules: Json
          severity?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          name?: string
          organization_id?: string
          remediation_action?: string | null
          rules?: Json
          severity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_compliance_policies_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_compliance_policies_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_compliance_policies_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_compliance_policies_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_compliance_policies_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_compliance_snapshots: {
        Row: {
          compliant: boolean
          created_at: string
          device_id: string
          evaluated_at: string
          id: string
          organization_id: string
          policy_id: string
          violations: Json | null
        }
        Insert: {
          compliant: boolean
          created_at?: string
          device_id: string
          evaluated_at?: string
          id?: string
          organization_id: string
          policy_id: string
          violations?: Json | null
        }
        Update: {
          compliant?: boolean
          created_at?: string
          device_id?: string
          evaluated_at?: string
          id?: string
          organization_id?: string
          policy_id?: string
          violations?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_compliance_snapshots_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_compliance_snapshots_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_compliance_snapshots_policy_id_fkey'
            columns: ['policy_id']
            isOneToOne: false
            referencedRelation: 'mdm_compliance_policies'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_compliance_violations: {
        Row: {
          created_at: string
          detected_at: string
          device_id: string
          id: string
          organization_id: string
          policy_id: string
          remediation_status: string
          resolved_at: string | null
          severity: string
          violation_details: Json
        }
        Insert: {
          created_at?: string
          detected_at?: string
          device_id: string
          id?: string
          organization_id: string
          policy_id: string
          remediation_status?: string
          resolved_at?: string | null
          severity: string
          violation_details: Json
        }
        Update: {
          created_at?: string
          detected_at?: string
          device_id?: string
          id?: string
          organization_id?: string
          policy_id?: string
          remediation_status?: string
          resolved_at?: string | null
          severity?: string
          violation_details?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_compliance_violations_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_compliance_violations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_compliance_violations_policy_id_fkey'
            columns: ['policy_id']
            isOneToOne: false
            referencedRelation: 'mdm_compliance_policies'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_device_groups: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          group_type: string
          id: string
          name: string
          organization_id: string
          parent_group_id: string | null
          smart_filter: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          group_type?: string
          id?: string
          name: string
          organization_id: string
          parent_group_id?: string | null
          smart_filter?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          group_type?: string
          id?: string
          name?: string
          organization_id?: string
          parent_group_id?: string | null
          smart_filter?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_device_groups_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_device_groups_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_device_groups_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_device_groups_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_device_groups_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_device_groups_parent_group_id_fkey'
            columns: ['parent_group_id']
            isOneToOne: false
            referencedRelation: 'mdm_device_groups'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_device_health_samples: {
        Row: {
          created_at: string
          device_id: string
          id: string
          metrics: Json
          timestamp: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          metrics: Json
          timestamp?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          metrics?: Json
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_device_health_samples_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_device_locations: {
        Row: {
          altitude: number | null
          created_at: string
          device_id: string
          heading: number | null
          horizontal_accuracy: number | null
          id: string
          latitude: number
          longitude: number
          organization_id: string
          source: string
          speed: number | null
          timestamp: string
          vertical_accuracy: number | null
        }
        Insert: {
          altitude?: number | null
          created_at?: string
          device_id: string
          heading?: number | null
          horizontal_accuracy?: number | null
          id?: string
          latitude: number
          longitude: number
          organization_id: string
          source?: string
          speed?: number | null
          timestamp: string
          vertical_accuracy?: number | null
        }
        Update: {
          altitude?: number | null
          created_at?: string
          device_id?: string
          heading?: number | null
          horizontal_accuracy?: number | null
          id?: string
          latitude?: number
          longitude?: number
          organization_id?: string
          source?: string
          speed?: number | null
          timestamp?: string
          vertical_accuracy?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_device_locations_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_device_locations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_device_secrets: {
        Row: {
          created_at: string
          device_id: string
          enrollment_token: string | null
          id: string
          push_magic: string | null
          push_token: string | null
          topic: string | null
          unlock_token: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id: string
          enrollment_token?: string | null
          id?: string
          push_magic?: string | null
          push_token?: string | null
          topic?: string | null
          unlock_token?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          enrollment_token?: string | null
          id?: string
          push_magic?: string | null
          push_token?: string | null
          topic?: string | null
          unlock_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_device_secrets_device_id_fkey'
            columns: ['device_id']
            isOneToOne: true
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_devices: {
        Row: {
          activation_lock_enabled: boolean | null
          assigned_user_id: string | null
          available_storage_bytes: number | null
          battery_cycle_count: number | null
          battery_health: string | null
          battery_level: number | null
          bluetooth_mac: string | null
          carrier: string | null
          cellular_technology: string | null
          created_at: string
          created_by: string | null
          dep_enrolled: boolean | null
          device_group_id: string | null
          device_name: string | null
          encrypted: boolean | null
          enrollment_date: string | null
          enrollment_type: string | null
          ethernet_mac: string | null
          firewall_enabled: boolean | null
          health_score: number | null
          id: string
          imei: string | null
          ip_address: unknown
          is_roaming: boolean | null
          last_checkin_at: string | null
          mdm_profile_installed: boolean | null
          meid: string | null
          model: string | null
          model_identifier: string | null
          notes: string | null
          organization_id: string
          os_build: string | null
          os_version: string | null
          passcode_compliant: boolean | null
          phone_number: string | null
          product_name: string | null
          retired_at: string | null
          serial_number: string | null
          status: string
          supervised: boolean | null
          tags: string[] | null
          topic: string | null
          total_storage_bytes: number | null
          udid: string | null
          updated_at: string
          updated_by: string | null
          wifi_mac: string | null
        }
        Insert: {
          activation_lock_enabled?: boolean | null
          assigned_user_id?: string | null
          available_storage_bytes?: number | null
          battery_cycle_count?: number | null
          battery_health?: string | null
          battery_level?: number | null
          bluetooth_mac?: string | null
          carrier?: string | null
          cellular_technology?: string | null
          created_at?: string
          created_by?: string | null
          dep_enrolled?: boolean | null
          device_group_id?: string | null
          device_name?: string | null
          encrypted?: boolean | null
          enrollment_date?: string | null
          enrollment_type?: string | null
          ethernet_mac?: string | null
          firewall_enabled?: boolean | null
          health_score?: number | null
          id?: string
          imei?: string | null
          ip_address?: unknown
          is_roaming?: boolean | null
          last_checkin_at?: string | null
          mdm_profile_installed?: boolean | null
          meid?: string | null
          model?: string | null
          model_identifier?: string | null
          notes?: string | null
          organization_id: string
          os_build?: string | null
          os_version?: string | null
          passcode_compliant?: boolean | null
          phone_number?: string | null
          product_name?: string | null
          retired_at?: string | null
          serial_number?: string | null
          status?: string
          supervised?: boolean | null
          tags?: string[] | null
          topic?: string | null
          total_storage_bytes?: number | null
          udid?: string | null
          updated_at?: string
          updated_by?: string | null
          wifi_mac?: string | null
        }
        Update: {
          activation_lock_enabled?: boolean | null
          assigned_user_id?: string | null
          available_storage_bytes?: number | null
          battery_cycle_count?: number | null
          battery_health?: string | null
          battery_level?: number | null
          bluetooth_mac?: string | null
          carrier?: string | null
          cellular_technology?: string | null
          created_at?: string
          created_by?: string | null
          dep_enrolled?: boolean | null
          device_group_id?: string | null
          device_name?: string | null
          encrypted?: boolean | null
          enrollment_date?: string | null
          enrollment_type?: string | null
          ethernet_mac?: string | null
          firewall_enabled?: boolean | null
          health_score?: number | null
          id?: string
          imei?: string | null
          ip_address?: unknown
          is_roaming?: boolean | null
          last_checkin_at?: string | null
          mdm_profile_installed?: boolean | null
          meid?: string | null
          model?: string | null
          model_identifier?: string | null
          notes?: string | null
          organization_id?: string
          os_build?: string | null
          os_version?: string | null
          passcode_compliant?: boolean | null
          phone_number?: string | null
          product_name?: string | null
          retired_at?: string | null
          serial_number?: string | null
          status?: string
          supervised?: boolean | null
          tags?: string[] | null
          topic?: string | null
          total_storage_bytes?: number | null
          udid?: string | null
          updated_at?: string
          updated_by?: string | null
          wifi_mac?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_devices_assigned_user_id_fkey'
            columns: ['assigned_user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_devices_assigned_user_id_fkey'
            columns: ['assigned_user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_devices_assigned_user_id_fkey'
            columns: ['assigned_user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_devices_assigned_user_id_fkey'
            columns: ['assigned_user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_devices_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_devices_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_devices_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_devices_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_devices_device_group_id_fkey'
            columns: ['device_group_id']
            isOneToOne: false
            referencedRelation: 'mdm_device_groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_devices_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_devices_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_devices_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_devices_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_devices_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      mdm_enrollments: {
        Row: {
          completed_at: string | null
          created_at: string
          device_id: string | null
          enrollment_profile_id: string | null
          enrollment_type: string
          error_message: string | null
          id: string
          initiated_by: string | null
          metadata: Json | null
          organization_id: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          device_id?: string | null
          enrollment_profile_id?: string | null
          enrollment_type: string
          error_message?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json | null
          organization_id: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          device_id?: string | null
          enrollment_profile_id?: string | null
          enrollment_type?: string
          error_message?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json | null
          organization_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_enrollments_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_enrollments_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_enrollments_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_enrollments_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_enrollments_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_enrollments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_geofence_events: {
        Row: {
          actions_executed: Json | null
          created_at: string
          device_id: string
          event_type: string
          geofence_id: string
          id: string
          latitude: number
          longitude: number
          organization_id: string
          triggered_at: string
        }
        Insert: {
          actions_executed?: Json | null
          created_at?: string
          device_id: string
          event_type: string
          geofence_id: string
          id?: string
          latitude: number
          longitude: number
          organization_id: string
          triggered_at?: string
        }
        Update: {
          actions_executed?: Json | null
          created_at?: string
          device_id?: string
          event_type?: string
          geofence_id?: string
          id?: string
          latitude?: number
          longitude?: number
          organization_id?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_geofence_events_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_geofence_events_geofence_id_fkey'
            columns: ['geofence_id']
            isOneToOne: false
            referencedRelation: 'mdm_geofences'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_geofence_events_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_geofences: {
        Row: {
          active_schedule: Json | null
          alert_type: string
          center_lat: number | null
          center_lng: number | null
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          geometry_type: string
          id: string
          name: string
          organization_id: string
          polygon_coordinates: Json | null
          radius_meters: number | null
          trigger_actions: Json | null
          updated_at: string
        }
        Insert: {
          active_schedule?: Json | null
          alert_type?: string
          center_lat?: number | null
          center_lng?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          geometry_type?: string
          id?: string
          name: string
          organization_id: string
          polygon_coordinates?: Json | null
          radius_meters?: number | null
          trigger_actions?: Json | null
          updated_at?: string
        }
        Update: {
          active_schedule?: Json | null
          alert_type?: string
          center_lat?: number | null
          center_lng?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          geometry_type?: string
          id?: string
          name?: string
          organization_id?: string
          polygon_coordinates?: Json | null
          radius_meters?: number | null
          trigger_actions?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_geofences_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_geofences_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_geofences_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_geofences_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_geofences_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_group_memberships: {
        Row: {
          added_at: string
          added_by: string | null
          device_id: string
          group_id: string
          id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          device_id: string
          group_id: string
          id?: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          device_id?: string
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_group_memberships_added_by_fkey'
            columns: ['added_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_group_memberships_added_by_fkey'
            columns: ['added_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_group_memberships_added_by_fkey'
            columns: ['added_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_group_memberships_added_by_fkey'
            columns: ['added_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_group_memberships_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_group_memberships_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'mdm_device_groups'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_incidents: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string
          description: string | null
          device_id: string | null
          id: string
          incident_type: string
          metadata: Json | null
          opened_at: string
          organization_id: string
          related_command_id: string | null
          resolved_at: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string | null
          device_id?: string | null
          id?: string
          incident_type: string
          metadata?: Json | null
          opened_at?: string
          organization_id: string
          related_command_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string | null
          device_id?: string | null
          id?: string
          incident_type?: string
          metadata?: Json | null
          opened_at?: string
          organization_id?: string
          related_command_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_incidents_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_incidents_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_incidents_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_incidents_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_incidents_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_incidents_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_incidents_related_command_id_fkey'
            columns: ['related_command_id']
            isOneToOne: false
            referencedRelation: 'mdm_commands'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_installed_apps: {
        Row: {
          app_id: string | null
          app_size_bytes: number | null
          bundle_id: string
          device_id: string
          discovered_at: string
          id: string
          installed_at: string | null
          is_managed: boolean | null
          name: string | null
          version: string | null
        }
        Insert: {
          app_id?: string | null
          app_size_bytes?: number | null
          bundle_id: string
          device_id: string
          discovered_at?: string
          id?: string
          installed_at?: string | null
          is_managed?: boolean | null
          name?: string | null
          version?: string | null
        }
        Update: {
          app_id?: string | null
          app_size_bytes?: number | null
          bundle_id?: string
          device_id?: string
          discovered_at?: string
          id?: string
          installed_at?: string | null
          is_managed?: boolean | null
          name?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_installed_apps_app_id_fkey'
            columns: ['app_id']
            isOneToOne: false
            referencedRelation: 'mdm_apps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_installed_apps_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_location_rollups_hourly: {
        Row: {
          avg_latitude: number | null
          avg_longitude: number | null
          created_at: string
          device_id: string
          hour_start: string
          id: string
          max_speed: number | null
          organization_id: string
          sample_count: number
          total_distance_meters: number | null
        }
        Insert: {
          avg_latitude?: number | null
          avg_longitude?: number | null
          created_at?: string
          device_id: string
          hour_start: string
          id?: string
          max_speed?: number | null
          organization_id: string
          sample_count?: number
          total_distance_meters?: number | null
        }
        Update: {
          avg_latitude?: number | null
          avg_longitude?: number | null
          created_at?: string
          device_id?: string
          hour_start?: string
          id?: string
          max_speed?: number | null
          organization_id?: string
          sample_count?: number
          total_distance_meters?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_location_rollups_hourly_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_location_rollups_hourly_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_manual_overrides: {
        Row: {
          actor_id: string
          created_at: string
          expires_at: string | null
          id: string
          ip_address: unknown
          is_break_glass: boolean | null
          organization_id: string
          override_data: Json | null
          override_type: string
          reason: string
          target_id: string
          target_type: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          ip_address?: unknown
          is_break_glass?: boolean | null
          organization_id: string
          override_data?: Json | null
          override_type: string
          reason: string
          target_id: string
          target_type: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          ip_address?: unknown
          is_break_glass?: boolean | null
          organization_id?: string
          override_data?: Json | null
          override_type?: string
          reason?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_manual_overrides_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_manual_overrides_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_manual_overrides_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_manual_overrides_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_manual_overrides_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_profile_assignments: {
        Row: {
          created_at: string
          device_id: string | null
          group_id: string | null
          id: string
          installed_at: string | null
          profile_id: string
          status: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          group_id?: string | null
          id?: string
          installed_at?: string | null
          profile_id: string
          status?: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          group_id?: string | null
          id?: string
          installed_at?: string | null
          profile_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_profile_assignments_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_profile_assignments_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'mdm_device_groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_profile_assignments_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'mdm_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          identifier: string
          is_encrypted: boolean | null
          name: string
          organization_id: string
          payload_plist: string | null
          profile_type: string
          removal_allowed: boolean | null
          scope: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          identifier: string
          is_encrypted?: boolean | null
          name: string
          organization_id: string
          payload_plist?: string | null
          profile_type: string
          removal_allowed?: boolean | null
          scope?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          identifier?: string
          is_encrypted?: boolean | null
          name?: string
          organization_id?: string
          payload_plist?: string | null
          profile_type?: string
          removal_allowed?: boolean | null
          scope?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_profiles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_profiles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_profiles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_profiles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_profiles_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_remote_action_audit: {
        Row: {
          action_type: string
          actor_id: string | null
          command_id: string | null
          correlation_id: string | null
          created_at: string
          device_id: string
          id: string
          ip_address: unknown
          organization_id: string
          outcome: string | null
          payload_hash: string | null
          user_agent: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          command_id?: string | null
          correlation_id?: string | null
          created_at?: string
          device_id: string
          id?: string
          ip_address?: unknown
          organization_id: string
          outcome?: string | null
          payload_hash?: string | null
          user_agent?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          command_id?: string | null
          correlation_id?: string | null
          created_at?: string
          device_id?: string
          id?: string
          ip_address?: unknown
          organization_id?: string
          outcome?: string | null
          payload_hash?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_remote_action_audit_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_remote_action_audit_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_remote_action_audit_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_remote_action_audit_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_remote_action_audit_command_id_fkey'
            columns: ['command_id']
            isOneToOne: false
            referencedRelation: 'mdm_commands'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_remote_action_audit_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_remote_action_audit_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_report_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          filters: Json | null
          format: string
          id: string
          last_run_at: string | null
          name: string
          organization_id: string
          recipients: Json
          report_type: string
          schedule_cron: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          filters?: Json | null
          format?: string
          id?: string
          last_run_at?: string | null
          name: string
          organization_id: string
          recipients?: Json
          report_type: string
          schedule_cron: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          filters?: Json | null
          format?: string
          id?: string
          last_run_at?: string | null
          name?: string
          organization_id?: string
          recipients?: Json
          report_type?: string
          schedule_cron?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_report_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_report_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_report_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_report_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_report_schedules_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_telemetry_sessions: {
        Row: {
          agent_version: string | null
          created_at: string
          device_id: string
          ended_at: string | null
          id: string
          last_heartbeat_at: string | null
          started_at: string
          status: string
        }
        Insert: {
          agent_version?: string | null
          created_at?: string
          device_id: string
          ended_at?: string | null
          id?: string
          last_heartbeat_at?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          agent_version?: string | null
          created_at?: string
          device_id?: string
          ended_at?: string | null
          id?: string
          last_heartbeat_at?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_telemetry_sessions_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'mdm_devices'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_workflow_executions: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          result: Json | null
          started_at: string
          status: string
          trigger_event: Json | null
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          result?: Json | null
          started_at?: string
          status?: string
          trigger_event?: Json | null
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          result?: Json | null
          started_at?: string
          status?: string
          trigger_event?: Json | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_workflow_executions_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'mdm_workflows'
            referencedColumns: ['id']
          },
        ]
      }
      mdm_workflows: {
        Row: {
          actions: Json
          conditions: Json | null
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          execution_count: number
          graph_data: Json | null
          id: string
          last_triggered_at: string | null
          name: string
          organization_id: string
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          conditions?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          execution_count?: number
          graph_data?: Json | null
          id?: string
          last_triggered_at?: string | null
          name: string
          organization_id: string
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          conditions?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          execution_count?: number
          graph_data?: Json | null
          id?: string
          last_triggered_at?: string | null
          name?: string
          organization_id?: string
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mdm_workflows_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_workflows_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_workflows_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mdm_workflows_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'mdm_workflows_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
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
          kind: string | null
          message: string | null
          organization_id: string
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
          kind?: string | null
          message?: string | null
          organization_id: string
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
          kind?: string | null
          message?: string | null
          organization_id?: string
          read?: boolean | null
          read_at?: string | null
          title?: string
          type?: Database['public']['Enums']['notification_type'] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      omnibelt_role_config: {
        Row: {
          created_at: string
          default_pinned_ids: string[]
          default_position: Json
          default_skin: string
          default_tool_ids: string[]
          id: string
          organization_id: string
          role_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          default_pinned_ids?: string[]
          default_position?: Json
          default_skin?: string
          default_tool_ids?: string[]
          id?: string
          organization_id: string
          role_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          default_pinned_ids?: string[]
          default_position?: Json
          default_skin?: string
          default_tool_ids?: string[]
          id?: string
          organization_id?: string
          role_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'omnibelt_role_config_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'omnibelt_role_config_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'role_permission_summary'
            referencedColumns: ['role_id']
          },
          {
            foreignKeyName: 'omnibelt_role_config_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      omnibelt_tool_events: {
        Row: {
          event_type: string
          id: number
          metadata: Json
          occurred_at: string
          organization_id: string
          tool_id: string
          user_id: string
        }
        Insert: {
          event_type: string
          id?: number
          metadata?: Json
          occurred_at?: string
          organization_id: string
          tool_id: string
          user_id: string
        }
        Update: {
          event_type?: string
          id?: number
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          tool_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'omnibelt_tool_events_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      omnibelt_user_prefs: {
        Row: {
          auto_hide_after_seconds: number
          hidden_tool_ids: string[]
          mach3_behavior: string
          organization_id: string
          pinned_tool_ids: string[]
          position_by_route: Json
          skin: string | null
          tool_order: string[]
          updated_at: string
          user_hidden: boolean
          user_id: string
        }
        Insert: {
          auto_hide_after_seconds?: number
          hidden_tool_ids?: string[]
          mach3_behavior?: string
          organization_id: string
          pinned_tool_ids?: string[]
          position_by_route?: Json
          skin?: string | null
          tool_order?: string[]
          updated_at?: string
          user_hidden?: boolean
          user_id: string
        }
        Update: {
          auto_hide_after_seconds?: number
          hidden_tool_ids?: string[]
          mach3_behavior?: string
          organization_id?: string
          pinned_tool_ids?: string[]
          position_by_route?: Json
          skin?: string | null
          tool_order?: string[]
          updated_at?: string
          user_hidden?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'omnibelt_user_prefs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_checklists_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_checklists_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_checklists_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_checklists_completed_by_fkey'
            columns: ['completed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_checklists_completed_by_fkey'
            columns: ['completed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_checklists_completed_by_fkey'
            columns: ['completed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_checklists_completed_by_fkey'
            columns: ['completed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_checklists_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_checklists_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_checklists_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_sessions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_sessions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_sessions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_sessions_created_user_id_fkey'
            columns: ['created_user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_sessions_created_user_id_fkey'
            columns: ['created_user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'onboarding_sessions_created_user_id_fkey'
            columns: ['created_user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_sessions_created_user_id_fkey'
            columns: ['created_user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_subordinate_id_fkey'
            columns: ['subordinate_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_subordinate_id_fkey'
            columns: ['subordinate_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_subordinate_id_fkey'
            columns: ['subordinate_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_supervisor_id_fkey'
            columns: ['supervisor_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_supervisor_id_fkey'
            columns: ['supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_supervisor_id_fkey'
            columns: ['supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_supervisor_id_fkey'
            columns: ['supervisor_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'role_permission_summary'
            referencedColumns: ['role_id']
          },
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_final_packed_by_fkey'
            columns: ['final_packed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_final_packed_by_fkey'
            columns: ['final_packed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_final_packed_by_fkey'
            columns: ['final_packed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_packed_by_fkey'
            columns: ['packed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_packed_by_fkey'
            columns: ['packed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_packed_by_fkey'
            columns: ['packed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_picked_by_fkey'
            columns: ['picked_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_picked_by_fkey'
            columns: ['picked_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_picked_by_fkey'
            columns: ['picked_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_picked_by_fkey'
            columns: ['picked_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_shipped_by_fkey'
            columns: ['shipped_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_shipped_by_fkey'
            columns: ['shipped_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_shipped_by_fkey'
            columns: ['shipped_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_shipped_by_fkey'
            columns: ['shipped_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_waved_by_fkey'
            columns: ['waved_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_waved_by_fkey'
            columns: ['waved_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_waved_by_fkey'
            columns: ['waved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_waved_by_fkey'
            columns: ['waved_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_wawf_placed_by_fkey'
            columns: ['wawf_placed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_wawf_placed_by_fkey'
            columns: ['wawf_placed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'outbound_to_data_wawf_placed_by_fkey'
            columns: ['wawf_placed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_wawf_placed_by_fkey'
            columns: ['wawf_placed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
          min_signups_required: number
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
          signup_cutoff_time: string | null
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
          min_signups_required?: number
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
          signup_cutoff_time?: string | null
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
          min_signups_required?: number
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
          signup_cutoff_time?: string | null
          status?: Database['public']['Enums']['overtime_status'] | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'overtime_requests_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'overtime_requests_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'overtime_requests_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'overtime_requests_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'overtime_requests_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'overtime_requests_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'overtime_requests_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'overtime_requests_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'overtime_requests_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'overtime_requests_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'overtime_requests_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'overtime_signups_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'overtime_signups_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'overtime_signups_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      permission_categories: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          display_name: string
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          order_index: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_name: string
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          order_index?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_name?: string
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          order_index?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      permission_dependencies: {
        Row: {
          created_at: string | null
          created_by: string | null
          dependency_type: string | null
          depends_on_permission_id: string
          id: string
          is_optional: boolean | null
          permission_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          dependency_type?: string | null
          depends_on_permission_id: string
          id?: string
          is_optional?: boolean | null
          permission_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          dependency_type?: string | null
          depends_on_permission_id?: string
          id?: string
          is_optional?: boolean | null
          permission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'permission_dependencies_depends_on_permission_id_fkey'
            columns: ['depends_on_permission_id']
            isOneToOne: false
            referencedRelation: 'permissions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'permission_dependencies_depends_on_permission_id_fkey'
            columns: ['depends_on_permission_id']
            isOneToOne: false
            referencedRelation: 'permissions_with_metadata'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'permission_dependencies_permission_id_fkey'
            columns: ['permission_id']
            isOneToOne: false
            referencedRelation: 'permissions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'permission_dependencies_permission_id_fkey'
            columns: ['permission_id']
            isOneToOne: false
            referencedRelation: 'permissions_with_metadata'
            referencedColumns: ['id']
          },
        ]
      }
      permission_tag_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          permission_id: string
          tag_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          permission_id: string
          tag_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          permission_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'permission_tag_assignments_permission_id_fkey'
            columns: ['permission_id']
            isOneToOne: false
            referencedRelation: 'permissions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'permission_tag_assignments_permission_id_fkey'
            columns: ['permission_id']
            isOneToOne: false
            referencedRelation: 'permissions_with_metadata'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'permission_tag_assignments_tag_id_fkey'
            columns: ['tag_id']
            isOneToOne: false
            referencedRelation: 'permission_tags'
            referencedColumns: ['id']
          },
        ]
      }
      permission_tags: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          display_name: string
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          action: string
          category_id: string | null
          created_at: string | null
          description: string | null
          id: string
          is_critical: boolean | null
          metadata: Json | null
          name: string
          requires_2fa: boolean | null
          resource: string
          risk_level: string | null
          scope: string | null
        }
        Insert: {
          action: string
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_critical?: boolean | null
          metadata?: Json | null
          name: string
          requires_2fa?: boolean | null
          resource: string
          risk_level?: string | null
          scope?: string | null
        }
        Update: {
          action?: string
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_critical?: boolean | null
          metadata?: Json | null
          name?: string
          requires_2fa?: boolean | null
          resource?: string
          risk_level?: string | null
          scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'permissions_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'permission_categories'
            referencedColumns: ['id']
          },
        ]
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'portal_invitations_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'portal_invitations_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'portal_invitations_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'position_level_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'position_level_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'position_level_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'position_type_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'position_type_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'position_type_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      production_board_card_layouts: {
        Row: {
          board_kind: string
          card_variant: string
          created_at: string
          grid_h: number
          grid_w: number
          grid_x: number
          grid_y: number
          id: string
          organization_id: string
          post_id: string
          post_kind: string
          scope: string
          updated_at: string
          variant_config: Json
        }
        Insert: {
          board_kind: string
          card_variant?: string
          created_at?: string
          grid_h?: number
          grid_w?: number
          grid_x?: number
          grid_y?: number
          id?: string
          organization_id: string
          post_id: string
          post_kind: string
          scope?: string
          updated_at?: string
          variant_config?: Json
        }
        Update: {
          board_kind?: string
          card_variant?: string
          created_at?: string
          grid_h?: number
          grid_w?: number
          grid_x?: number
          grid_y?: number
          id?: string
          organization_id?: string
          post_id?: string
          post_kind?: string
          scope?: string
          updated_at?: string
          variant_config?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'production_board_card_layouts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      production_board_job_postings: {
        Row: {
          apply_email: string | null
          apply_url: string | null
          attachments: Json
          branch_id: string | null
          closes_at: string | null
          color_hex: string | null
          created_at: string
          department: string | null
          description: string | null
          id: string
          is_internal: boolean
          is_published: boolean
          kind_data: Json
          organization_id: string
          posted_at: string
          posted_by: string | null
          priority: string
          requirements: string | null
          title: string
          updated_at: string
          working_area_id: string | null
        }
        Insert: {
          apply_email?: string | null
          apply_url?: string | null
          attachments?: Json
          branch_id?: string | null
          closes_at?: string | null
          color_hex?: string | null
          created_at?: string
          department?: string | null
          description?: string | null
          id?: string
          is_internal?: boolean
          is_published?: boolean
          kind_data?: Json
          organization_id: string
          posted_at?: string
          posted_by?: string | null
          priority?: string
          requirements?: string | null
          title: string
          updated_at?: string
          working_area_id?: string | null
        }
        Update: {
          apply_email?: string | null
          apply_url?: string | null
          attachments?: Json
          branch_id?: string | null
          closes_at?: string | null
          color_hex?: string | null
          created_at?: string
          department?: string | null
          description?: string | null
          id?: string
          is_internal?: boolean
          is_published?: boolean
          kind_data?: Json
          organization_id?: string
          posted_at?: string
          posted_by?: string | null
          priority?: string
          requirements?: string | null
          title?: string
          updated_at?: string
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'production_board_job_postings_branch_id_fkey'
            columns: ['branch_id']
            isOneToOne: false
            referencedRelation: 'branches'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_job_postings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_job_postings_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_job_postings_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_job_postings_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_job_postings_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_job_postings_working_area_id_fkey'
            columns: ['working_area_id']
            isOneToOne: false
            referencedRelation: 'working_areas'
            referencedColumns: ['id']
          },
        ]
      }
      production_board_post_acks: {
        Row: {
          acknowledged_at: string
          id: string
          organization_id: string
          post_id: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          id?: string
          organization_id: string
          post_id: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          id?: string
          organization_id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'production_board_post_acks_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_post_acks_post_id_fkey'
            columns: ['post_id']
            isOneToOne: false
            referencedRelation: 'production_board_posts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_post_acks_post_id_fkey'
            columns: ['post_id']
            isOneToOne: false
            referencedRelation: 'v_active_board_posts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_post_acks_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_post_acks_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_post_acks_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_post_acks_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      production_board_posts: {
        Row: {
          acknowledged_required: boolean
          attachments: Json
          body: string | null
          branch_id: string | null
          color_hex: string | null
          created_at: string
          expires_at: string | null
          id: string
          image_url: string | null
          is_pinned: boolean
          is_published: boolean
          kind_data: Json
          organization_id: string
          posted_by: string | null
          priority: string
          published_at: string
          reprompt_interval_minutes: number | null
          scope: Database['public']['Enums']['post_scope']
          severity: Database['public']['Enums']['post_severity']
          title: string
          updated_at: string
          working_area_id: string | null
        }
        Insert: {
          acknowledged_required?: boolean
          attachments?: Json
          body?: string | null
          branch_id?: string | null
          color_hex?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_pinned?: boolean
          is_published?: boolean
          kind_data?: Json
          organization_id: string
          posted_by?: string | null
          priority?: string
          published_at?: string
          reprompt_interval_minutes?: number | null
          scope: Database['public']['Enums']['post_scope']
          severity?: Database['public']['Enums']['post_severity']
          title: string
          updated_at?: string
          working_area_id?: string | null
        }
        Update: {
          acknowledged_required?: boolean
          attachments?: Json
          body?: string | null
          branch_id?: string | null
          color_hex?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_pinned?: boolean
          is_published?: boolean
          kind_data?: Json
          organization_id?: string
          posted_by?: string | null
          priority?: string
          published_at?: string
          reprompt_interval_minutes?: number | null
          scope?: Database['public']['Enums']['post_scope']
          severity?: Database['public']['Enums']['post_severity']
          title?: string
          updated_at?: string
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'production_board_posts_branch_id_fkey'
            columns: ['branch_id']
            isOneToOne: false
            referencedRelation: 'branches'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_posts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_posts_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_posts_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_posts_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_posts_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_posts_working_area_id_fkey'
            columns: ['working_area_id']
            isOneToOne: false
            referencedRelation: 'working_areas'
            referencedColumns: ['id']
          },
        ]
      }
      production_board_sqcdp_categories: {
        Row: {
          created_at: string
          created_by: string | null
          default_color_hex: string
          display_order: number
          icon_name: string
          id: string
          is_builtin: boolean
          is_hidden: boolean
          label: string
          organization_id: string
          slug: string
          tier: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_color_hex: string
          display_order?: number
          icon_name: string
          id?: string
          is_builtin?: boolean
          is_hidden?: boolean
          label: string
          organization_id: string
          slug: string
          tier: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_color_hex?: string
          display_order?: number
          icon_name?: string
          id?: string
          is_builtin?: boolean
          is_hidden?: boolean
          label?: string
          organization_id?: string
          slug?: string
          tier?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'production_board_sqcdp_categories_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      production_boards: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_enabled: boolean
          organization_id: string
          slug: string
          subtitle: string | null
          theme: Json
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_enabled?: boolean
          organization_id: string
          slug: string
          subtitle?: string | null
          theme?: Json
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_enabled?: boolean
          organization_id?: string
          slug?: string
          subtitle?: string | null
          theme?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'production_boards_organization_id_fkey'
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'putback_tickets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'putback_tickets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'putback_tickets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'putback_tickets_processed_by_fkey'
            columns: ['processed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'putback_tickets_processed_by_fkey'
            columns: ['processed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'putback_tickets_processed_by_fkey'
            columns: ['processed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'queue_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'queue_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'queue_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      review_categories: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'review_categories_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      review_scores: {
        Row: {
          category_id: string
          comments: string | null
          created_at: string | null
          id: string
          review_id: string
          score: number | null
        }
        Insert: {
          category_id: string
          comments?: string | null
          created_at?: string | null
          id?: string
          review_id: string
          score?: number | null
        }
        Update: {
          category_id?: string
          comments?: string | null
          created_at?: string | null
          id?: string
          review_id?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'review_scores_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'review_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'review_scores_review_id_fkey'
            columns: ['review_id']
            isOneToOne: false
            referencedRelation: 'employee_reviews'
            referencedColumns: ['id']
          },
        ]
      }
      rf_putaway_operations: {
        Row: {
          cart_stow_assignment_id: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_by_agent_id: string | null
          confirmed_by_label: string | null
          confirmed_source: string | null
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
          stow_cart_cleared_at: string | null
          stow_cart_number: string | null
          to_location: string
          to_number: string
          to_status: string | null
          updated_at: string | null
          warehouse: string | null
        }
        Insert: {
          cart_stow_assignment_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_by_agent_id?: string | null
          confirmed_by_label?: string | null
          confirmed_source?: string | null
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
          stow_cart_cleared_at?: string | null
          stow_cart_number?: string | null
          to_location: string
          to_number: string
          to_status?: string | null
          updated_at?: string | null
          warehouse?: string | null
        }
        Update: {
          cart_stow_assignment_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_by_agent_id?: string | null
          confirmed_by_label?: string | null
          confirmed_source?: string | null
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
          stow_cart_cleared_at?: string | null
          stow_cart_number?: string | null
          to_location?: string
          to_number?: string
          to_status?: string | null
          updated_at?: string | null
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rf_putaway_operations_cart_stow_assignment_id_fkey'
            columns: ['cart_stow_assignment_id']
            isOneToOne: false
            referencedRelation: 'inbound_cart_assignments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rf_putaway_operations_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rf_putaway_operations_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rf_putaway_operations_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rf_putaway_operations_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rf_putaway_operations_mca_processed_by_fkey'
            columns: ['mca_processed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rf_putaway_operations_mca_processed_by_fkey'
            columns: ['mca_processed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rf_putaway_operations_mca_processed_by_fkey'
            columns: ['mca_processed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rf_putaway_operations_mca_processed_by_fkey'
            columns: ['mca_processed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'role_delegation_delegate_id_fkey'
            columns: ['delegate_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'role_delegation_delegate_id_fkey'
            columns: ['delegate_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'role_delegation_delegate_id_fkey'
            columns: ['delegate_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'role_delegation_delegator_id_fkey'
            columns: ['delegator_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'role_delegation_delegator_id_fkey'
            columns: ['delegator_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'role_delegation_delegator_id_fkey'
            columns: ['delegator_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'role_delegation_delegator_id_fkey'
            columns: ['delegator_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'role_permission_summary'
            referencedColumns: ['role_id']
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
            foreignKeyName: 'role_permissions_permission_id_fkey'
            columns: ['permission_id']
            isOneToOne: false
            referencedRelation: 'permissions_with_metadata'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'role_permissions_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'role_permission_summary'
            referencedColumns: ['role_id']
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
            referencedRelation: 'role_permission_summary'
            referencedColumns: ['role_id']
          },
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
          {
            foreignKeyName: 'role_tab_permissions_tab_definition_id_fkey'
            columns: ['tab_definition_id']
            isOneToOne: false
            referencedRelation: 'tab_permissions'
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
          parent_role_id: string | null
          priority: number | null
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
          parent_role_id?: string | null
          priority?: number | null
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
          parent_role_id?: string | null
          priority?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'roles_parent_role_id_fkey'
            columns: ['parent_role_id']
            isOneToOne: false
            referencedRelation: 'role_permission_summary'
            referencedColumns: ['role_id']
          },
          {
            foreignKeyName: 'roles_parent_role_id_fkey'
            columns: ['parent_role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_customer_portal_activity_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_customer_portal_activity_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_customer_portal_activity_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_customer_portal_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_customer_portal_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_customer_portal_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_original_counter_id_fkey'
            columns: ['original_counter_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_original_counter_id_fkey'
            columns: ['original_counter_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_original_counter_id_fkey'
            columns: ['original_counter_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_recount_counter_id_fkey'
            columns: ['recount_counter_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_recount_counter_id_fkey'
            columns: ['recount_counter_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_recount_counter_id_fkey'
            columns: ['recount_counter_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_recount_counter_id_fkey'
            columns: ['recount_counter_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
          count_type: string | null
          counted_quantity: number | null
          counter_name: string | null
          created_at: string
          created_by: string
          evidence_photo_urls: string[] | null
          id: string
          location: string
          location_reported_empty: boolean | null
          material_description: string | null
          material_number: string
          notes: string | null
          organization_id: string
          part_variance: boolean | null
          priority: Database['public']['Enums']['cycle_count_priority']
          push_acknowledged: boolean | null
          push_acknowledged_at: string | null
          push_mode: string | null
          pushed_at: string | null
          pushed_by: string | null
          reassignment_count: number | null
          recount_by: string | null
          recount_completed: boolean | null
          recount_date: string | null
          requires_recount: boolean | null
          reservation_started_at: string | null
          resolution_source: string | null
          resolved_aisle: string | null
          resolved_location_key: string | null
          resolved_sequence: number | null
          resolved_zone: string | null
          review_threshold_abs: number | null
          review_threshold_pct: number | null
          scanned_material_number: string | null
          scanned_parts: Json
          scanner_type: string | null
          serial_numbers: string[] | null
          session_id: string | null
          status: Database['public']['Enums']['cycle_count_status'] | null
          supervisor_assigned_at: string | null
          supervisor_assigned_by: string | null
          system_quantity: number
          transfer_destination_location: string | null
          transfer_source_quantity: number | null
          unit_of_measure: string | null
          updated_at: string | null
          variance_percentage: number | null
          variance_quantity: number | null
          warehouse: string | null
          warehouse_location_mapping_id: string | null
          workflow_config_id: string | null
          workflow_config_version: number | null
          workflow_result: Json
          workflow_snapshot: Json
          zone: string | null
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
          count_type?: string | null
          counted_quantity?: number | null
          counter_name?: string | null
          created_at?: string
          created_by: string
          evidence_photo_urls?: string[] | null
          id?: string
          location: string
          location_reported_empty?: boolean | null
          material_description?: string | null
          material_number: string
          notes?: string | null
          organization_id: string
          part_variance?: boolean | null
          priority?: Database['public']['Enums']['cycle_count_priority']
          push_acknowledged?: boolean | null
          push_acknowledged_at?: string | null
          push_mode?: string | null
          pushed_at?: string | null
          pushed_by?: string | null
          reassignment_count?: number | null
          recount_by?: string | null
          recount_completed?: boolean | null
          recount_date?: string | null
          requires_recount?: boolean | null
          reservation_started_at?: string | null
          resolution_source?: string | null
          resolved_aisle?: string | null
          resolved_location_key?: string | null
          resolved_sequence?: number | null
          resolved_zone?: string | null
          review_threshold_abs?: number | null
          review_threshold_pct?: number | null
          scanned_material_number?: string | null
          scanned_parts?: Json
          scanner_type?: string | null
          serial_numbers?: string[] | null
          session_id?: string | null
          status?: Database['public']['Enums']['cycle_count_status'] | null
          supervisor_assigned_at?: string | null
          supervisor_assigned_by?: string | null
          system_quantity?: number
          transfer_destination_location?: string | null
          transfer_source_quantity?: number | null
          unit_of_measure?: string | null
          updated_at?: string | null
          variance_percentage?: number | null
          variance_quantity?: number | null
          warehouse?: string | null
          warehouse_location_mapping_id?: string | null
          workflow_config_id?: string | null
          workflow_config_version?: number | null
          workflow_result?: Json
          workflow_snapshot?: Json
          zone?: string | null
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
          count_type?: string | null
          counted_quantity?: number | null
          counter_name?: string | null
          created_at?: string
          created_by?: string
          evidence_photo_urls?: string[] | null
          id?: string
          location?: string
          location_reported_empty?: boolean | null
          material_description?: string | null
          material_number?: string
          notes?: string | null
          organization_id?: string
          part_variance?: boolean | null
          priority?: Database['public']['Enums']['cycle_count_priority']
          push_acknowledged?: boolean | null
          push_acknowledged_at?: string | null
          push_mode?: string | null
          pushed_at?: string | null
          pushed_by?: string | null
          reassignment_count?: number | null
          recount_by?: string | null
          recount_completed?: boolean | null
          recount_date?: string | null
          requires_recount?: boolean | null
          reservation_started_at?: string | null
          resolution_source?: string | null
          resolved_aisle?: string | null
          resolved_location_key?: string | null
          resolved_sequence?: number | null
          resolved_zone?: string | null
          review_threshold_abs?: number | null
          review_threshold_pct?: number | null
          scanned_material_number?: string | null
          scanned_parts?: Json
          scanner_type?: string | null
          serial_numbers?: string[] | null
          session_id?: string | null
          status?: Database['public']['Enums']['cycle_count_status'] | null
          supervisor_assigned_at?: string | null
          supervisor_assigned_by?: string | null
          system_quantity?: number
          transfer_destination_location?: string | null
          transfer_source_quantity?: number | null
          unit_of_measure?: string | null
          updated_at?: string | null
          variance_percentage?: number | null
          variance_quantity?: number | null
          warehouse?: string | null
          warehouse_location_mapping_id?: string | null
          workflow_config_id?: string | null
          workflow_config_version?: number | null
          workflow_result?: Json
          workflow_snapshot?: Json
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_cyclecount_data_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_pushed_by_fkey'
            columns: ['pushed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_pushed_by_fkey'
            columns: ['pushed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_pushed_by_fkey'
            columns: ['pushed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_pushed_by_fkey'
            columns: ['pushed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_supervisor_assigned_by_fkey'
            columns: ['supervisor_assigned_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_supervisor_assigned_by_fkey'
            columns: ['supervisor_assigned_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_supervisor_assigned_by_fkey'
            columns: ['supervisor_assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_supervisor_assigned_by_fkey'
            columns: ['supervisor_assigned_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_warehouse_location_mapping_id_fkey'
            columns: ['warehouse_location_mapping_id']
            isOneToOne: false
            referencedRelation: 'warehouse_location_mappings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_workflow_config_id_fkey'
            columns: ['workflow_config_id']
            isOneToOne: false
            referencedRelation: 'cycle_count_workflow_configs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_workflow_config_id_fkey'
            columns: ['workflow_config_id']
            isOneToOne: false
            referencedRelation: 'work_workflow_configs'
            referencedColumns: ['id']
          },
        ]
      }
      rr_drop_off_area_associates: {
        Row: {
          badge_code: string | null
          created_at: string
          created_by: string | null
          drop_off_area_id: string
          full_name: string | null
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          badge_code?: string | null
          created_at?: string
          created_by?: string | null
          drop_off_area_id: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          badge_code?: string | null
          created_at?: string
          created_by?: string | null
          drop_off_area_id?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'rr_drop_off_area_associates_drop_off_area_id_fkey'
            columns: ['drop_off_area_id']
            isOneToOne: false
            referencedRelation: 'rr_drop_off_areas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_drop_off_area_associates_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_drop_off_area_associates_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_drop_off_area_associates_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_drop_off_area_associates_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_drop_off_area_associates_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      rr_drop_off_areas: {
        Row: {
          barcode: string
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          barcode: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          barcode?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_drop_off_areas_organization_id_fkey'
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_grip_processing_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_grip_processing_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_grip_processing_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_grsgrip_processing_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_grsgrip_processing_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_grsgrip_processing_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      rr_hot_part_alerts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          match_type: string
          match_value: string
          notes: string | null
          organization_id: string
          priority: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          match_type?: string
          match_value: string
          notes?: string | null
          organization_id: string
          priority?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          match_type?: string
          match_value?: string
          notes?: string | null
          organization_id?: string
          priority?: string
          updated_at?: string
        }
        Relationships: []
      }
      rr_inbound_part_transfers: {
        Row: {
          accepted_at: string
          accepted_by_associate_id: string
          created_at: string
          drop_off_area_id: string
          dropped_off_at: string
          dropped_off_by: string
          id: string
          notes: string | null
          organization_id: string
          tka_batch_number: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string
          accepted_by_associate_id: string
          created_at?: string
          drop_off_area_id: string
          dropped_off_at?: string
          dropped_off_by: string
          id?: string
          notes?: string | null
          organization_id: string
          tka_batch_number: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string
          accepted_by_associate_id?: string
          created_at?: string
          drop_off_area_id?: string
          dropped_off_at?: string
          dropped_off_by?: string
          id?: string
          notes?: string | null
          organization_id?: string
          tka_batch_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'rr_inbound_part_transfers_accepted_by_associate_id_fkey'
            columns: ['accepted_by_associate_id']
            isOneToOne: false
            referencedRelation: 'rr_drop_off_area_associates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_drop_off_area_id_fkey'
            columns: ['drop_off_area_id']
            isOneToOne: false
            referencedRelation: 'rr_drop_off_areas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_dropped_off_by_fkey'
            columns: ['dropped_off_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_dropped_off_by_fkey'
            columns: ['dropped_off_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_dropped_off_by_fkey'
            columns: ['dropped_off_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_dropped_off_by_fkey'
            columns: ['dropped_off_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_organization_id_fkey'
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_inbound_scans_scanned_by_fkey'
            columns: ['scanned_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_inbound_scans_scanned_by_fkey'
            columns: ['scanned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_inbound_scans_scanned_by_fkey'
            columns: ['scanned_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      RR_Kitting_DATA: {
        Row: {
          authorized_ship_short_items: Json | null
          batch: string | null
          cancelled: boolean
          cancelled_at: string | null
          cancelled_by_user: string | null
          cancelled_reason: string | null
          charge_code: string | null
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
          kit_cart_color: string | null
          kit_container_type: string | null
          kit_definition_id: string | null
          kit_dock_location: string | null
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
          missing_part_flag: boolean | null
          missing_part_notes: string | null
          missing_part_photo_url: string | null
          missing_part_reported_at: string | null
          missing_part_reported_by_user: string | null
          missing_part_verified_adjacent_bins: boolean | null
          movement_type_im: string | null
          movement_type_wm: string | null
          part_expedite_delivery_time: string | null
          part_expedite_description: string | null
          part_expedite_part_number: string | null
          part_expedite_quantity: number | null
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
          visual_pick_verification_flag: boolean | null
          warehouse_number: string | null
        }
        Insert: {
          authorized_ship_short_items?: Json | null
          batch?: string | null
          cancelled?: boolean
          cancelled_at?: string | null
          cancelled_by_user?: string | null
          cancelled_reason?: string | null
          charge_code?: string | null
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
          kit_cart_color?: string | null
          kit_container_type?: string | null
          kit_definition_id?: string | null
          kit_dock_location?: string | null
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
          missing_part_flag?: boolean | null
          missing_part_notes?: string | null
          missing_part_photo_url?: string | null
          missing_part_reported_at?: string | null
          missing_part_reported_by_user?: string | null
          missing_part_verified_adjacent_bins?: boolean | null
          movement_type_im?: string | null
          movement_type_wm?: string | null
          part_expedite_delivery_time?: string | null
          part_expedite_description?: string | null
          part_expedite_part_number?: string | null
          part_expedite_quantity?: number | null
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
          visual_pick_verification_flag?: boolean | null
          warehouse_number?: string | null
        }
        Update: {
          authorized_ship_short_items?: Json | null
          batch?: string | null
          cancelled?: boolean
          cancelled_at?: string | null
          cancelled_by_user?: string | null
          cancelled_reason?: string | null
          charge_code?: string | null
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
          kit_cart_color?: string | null
          kit_container_type?: string | null
          kit_definition_id?: string | null
          kit_dock_location?: string | null
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
          missing_part_flag?: boolean | null
          missing_part_notes?: string | null
          missing_part_photo_url?: string | null
          missing_part_reported_at?: string | null
          missing_part_reported_by_user?: string | null
          missing_part_verified_adjacent_bins?: boolean | null
          movement_type_im?: string | null
          movement_type_wm?: string | null
          part_expedite_delivery_time?: string | null
          part_expedite_description?: string | null
          part_expedite_part_number?: string | null
          part_expedite_quantity?: number | null
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
          visual_pick_verification_flag?: boolean | null
          warehouse_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'RR_Kitting_DATA_cancelled_by_user_fkey'
            columns: ['cancelled_by_user']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_cancelled_by_user_fkey'
            columns: ['cancelled_by_user']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_cancelled_by_user_fkey'
            columns: ['cancelled_by_user']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_cancelled_by_user_fkey'
            columns: ['cancelled_by_user']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kanban_task_id_fkey'
            columns: ['kanban_task_id']
            isOneToOne: false
            referencedRelation: 'kit_kanban_tasks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_definition_id_fkey'
            columns: ['kit_definition_id']
            isOneToOne: false
            referencedRelation: 'kit_definitions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_flag_cleared_by_user_fkey'
            columns: ['kit_flag_cleared_by_user']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_flag_cleared_by_user_fkey'
            columns: ['kit_flag_cleared_by_user']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_flag_cleared_by_user_fkey'
            columns: ['kit_flag_cleared_by_user']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_flag_cleared_by_user_fkey'
            columns: ['kit_flag_cleared_by_user']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_flag_set_by_user_fkey'
            columns: ['kit_flag_set_by_user']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_flag_set_by_user_fkey'
            columns: ['kit_flag_set_by_user']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_flag_set_by_user_fkey'
            columns: ['kit_flag_set_by_user']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_flag_set_by_user_fkey'
            columns: ['kit_flag_set_by_user']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      sap_agent_console_log: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          level: string
          message: string
          organization_id: string
          ts: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          level: string
          message: string
          organization_id: string
          ts: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          level?: string
          message?: string
          organization_id?: string
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sap_agent_console_log_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      sap_agent_jobs: {
        Row: {
          assigned_agent_id: string | null
          attempts: number
          claim_count: number
          claim_lease_until: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          endpoint: string
          error: string | null
          heartbeat_at: string | null
          id: string
          idempotency_key: string | null
          max_attempts: number
          organization_id: string
          payload: Json
          priority: number
          requested_by: string | null
          result: Json | null
          started_at: string | null
          status: string
          step: string | null
        }
        Insert: {
          assigned_agent_id?: string | null
          attempts?: number
          claim_count?: number
          claim_lease_until?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          endpoint: string
          error?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string | null
          max_attempts?: number
          organization_id: string
          payload?: Json
          priority?: number
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          step?: string | null
        }
        Update: {
          assigned_agent_id?: string | null
          attempts?: number
          claim_count?: number
          claim_lease_until?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          endpoint?: string
          error?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string | null
          max_attempts?: number
          organization_id?: string
          payload?: Json
          priority?: number
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          step?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'sap_agent_jobs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sap_agent_jobs_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sap_agent_jobs_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sap_agent_jobs_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sap_agent_jobs_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      sap_agent_schedules: {
        Row: {
          assigned_agent_id: string | null
          created_at: string
          created_by: string | null
          cron_expression: string
          description: string | null
          enabled: boolean
          endpoint: string
          id: string
          last_error: string | null
          last_job_id: string | null
          last_run_at: string | null
          max_attempts: number
          name: string
          next_run_at: string
          organization_id: string
          payload: Json
          priority: number
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          created_at?: string
          created_by?: string | null
          cron_expression: string
          description?: string | null
          enabled?: boolean
          endpoint: string
          id?: string
          last_error?: string | null
          last_job_id?: string | null
          last_run_at?: string | null
          max_attempts?: number
          name: string
          next_run_at?: string
          organization_id: string
          payload?: Json
          priority?: number
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          created_at?: string
          created_by?: string | null
          cron_expression?: string
          description?: string | null
          enabled?: boolean
          endpoint?: string
          id?: string
          last_error?: string | null
          last_job_id?: string | null
          last_run_at?: string | null
          max_attempts?: number
          name?: string
          next_run_at?: string
          organization_id?: string
          payload?: Json
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sap_agent_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sap_agent_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sap_agent_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sap_agent_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sap_agent_schedules_last_job_id_fkey'
            columns: ['last_job_id']
            isOneToOne: false
            referencedRelation: 'sap_agent_jobs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sap_agent_schedules_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      sap_agents: {
        Row: {
          capabilities: Json
          citrix_session: string | null
          current_action: Json | null
          display_name: string | null
          hostname: string | null
          id: string
          last_seen_at: string
          organization_id: string
          process_started_at: string | null
          registered_at: string
          sap_client: string | null
          sap_system: string | null
          sap_user: string | null
          status: string
          transactions_per_hour: number | null
          version: string | null
        }
        Insert: {
          capabilities?: Json
          citrix_session?: string | null
          current_action?: Json | null
          display_name?: string | null
          hostname?: string | null
          id: string
          last_seen_at?: string
          organization_id: string
          process_started_at?: string | null
          registered_at?: string
          sap_client?: string | null
          sap_system?: string | null
          sap_user?: string | null
          status?: string
          transactions_per_hour?: number | null
          version?: string | null
        }
        Update: {
          capabilities?: Json
          citrix_session?: string | null
          current_action?: Json | null
          display_name?: string | null
          hostname?: string | null
          id?: string
          last_seen_at?: string
          organization_id?: string
          process_started_at?: string | null
          registered_at?: string
          sap_client?: string | null
          sap_system?: string | null
          sap_user?: string | null
          status?: string
          transactions_per_hour?: number | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'sap_agents_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      sap_audit_log: {
        Row: {
          action: string
          agent_version: string | null
          created_at: string
          duration_ms: number | null
          id: string
          job_id: string | null
          organization_id: string
          payload: Json | null
          prev_state: Json | null
          result: Json | null
          reversal_status: string | null
          reverses_audit_id: string | null
          sap_message: string | null
          sap_message_type: string | null
          status: string
          step: string | null
          transaction_code: string
          user_id: string | null
        }
        Insert: {
          action: string
          agent_version?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          job_id?: string | null
          organization_id: string
          payload?: Json | null
          prev_state?: Json | null
          result?: Json | null
          reversal_status?: string | null
          reverses_audit_id?: string | null
          sap_message?: string | null
          sap_message_type?: string | null
          status: string
          step?: string | null
          transaction_code: string
          user_id?: string | null
        }
        Update: {
          action?: string
          agent_version?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          job_id?: string | null
          organization_id?: string
          payload?: Json | null
          prev_state?: Json | null
          result?: Json | null
          reversal_status?: string | null
          reverses_audit_id?: string | null
          sap_message?: string | null
          sap_message_type?: string | null
          status?: string
          step?: string | null
          transaction_code?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'sap_audit_log_job_id_fkey'
            columns: ['job_id']
            isOneToOne: false
            referencedRelation: 'sap_agent_jobs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sap_audit_log_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sap_audit_log_reverses_audit_id_fkey'
            columns: ['reverses_audit_id']
            isOneToOne: false
            referencedRelation: 'sap_audit_log'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sap_audit_log_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sap_audit_log_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sap_audit_log_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sap_audit_log_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
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
      sap_outbound_to_import_runs: {
        Row: {
          agent_id: string | null
          completed_at: string | null
          date_from: string | null
          date_to: string | null
          duration_ms: number | null
          error: string | null
          id: string
          job_id: string | null
          layout_variant: string | null
          organization_id: string
          rows_imported: number | null
          show_open_only: boolean | null
          show_verified: boolean | null
          started_at: string | null
          status: string
          storage_type: string | null
          triggered_by: string | null
          warehouse: string
        }
        Insert: {
          agent_id?: string | null
          completed_at?: string | null
          date_from?: string | null
          date_to?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          job_id?: string | null
          layout_variant?: string | null
          organization_id: string
          rows_imported?: number | null
          show_open_only?: boolean | null
          show_verified?: boolean | null
          started_at?: string | null
          status?: string
          storage_type?: string | null
          triggered_by?: string | null
          warehouse: string
        }
        Update: {
          agent_id?: string | null
          completed_at?: string | null
          date_from?: string | null
          date_to?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          job_id?: string | null
          layout_variant?: string | null
          organization_id?: string
          rows_imported?: number | null
          show_open_only?: boolean | null
          show_verified?: boolean | null
          started_at?: string | null
          status?: string
          storage_type?: string | null
          triggered_by?: string | null
          warehouse?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sap_outbound_to_import_runs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      sap_outbound_to_imports: {
        Row: {
          confirmed_by_sap: string | null
          confirmed_in_sap: string | null
          created_in_sap: string | null
          delivery: string | null
          dest_storage_bin: string | null
          dest_storage_type: string | null
          id: string
          import_batch_id: string
          import_run_id: string | null
          imported_at: string
          material: string | null
          movement_type: string | null
          organization_id: string
          quantity: number | null
          raw_row: Json | null
          reference_doc: string | null
          source_storage_bin: string | null
          source_storage_type: string | null
          status: string | null
          status_code: string | null
          storage_type: string | null
          to_number: string
          unit_of_measure: string | null
          warehouse: string
        }
        Insert: {
          confirmed_by_sap?: string | null
          confirmed_in_sap?: string | null
          created_in_sap?: string | null
          delivery?: string | null
          dest_storage_bin?: string | null
          dest_storage_type?: string | null
          id?: string
          import_batch_id: string
          import_run_id?: string | null
          imported_at?: string
          material?: string | null
          movement_type?: string | null
          organization_id: string
          quantity?: number | null
          raw_row?: Json | null
          reference_doc?: string | null
          source_storage_bin?: string | null
          source_storage_type?: string | null
          status?: string | null
          status_code?: string | null
          storage_type?: string | null
          to_number: string
          unit_of_measure?: string | null
          warehouse: string
        }
        Update: {
          confirmed_by_sap?: string | null
          confirmed_in_sap?: string | null
          created_in_sap?: string | null
          delivery?: string | null
          dest_storage_bin?: string | null
          dest_storage_type?: string | null
          id?: string
          import_batch_id?: string
          import_run_id?: string | null
          imported_at?: string
          material?: string | null
          movement_type?: string | null
          organization_id?: string
          quantity?: number | null
          raw_row?: Json | null
          reference_doc?: string | null
          source_storage_bin?: string | null
          source_storage_type?: string | null
          status?: string | null
          status_code?: string | null
          storage_type?: string | null
          to_number?: string
          unit_of_measure?: string | null
          warehouse?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sap_outbound_to_imports_organization_id_fkey'
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'security_alerts_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'security_alerts_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'security_alerts_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'security_alerts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'security_alerts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'security_alerts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'security_alerts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      service_api_key_usage: {
        Row: {
          api_key_id: string | null
          created_at: string | null
          endpoint: string
          id: string
          ip_address: unknown
          response_status: number | null
          response_time_ms: number | null
          service_name: string
          user_agent: string | null
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string | null
          endpoint: string
          id?: string
          ip_address?: unknown
          response_status?: number | null
          response_time_ms?: number | null
          service_name: string
          user_agent?: string | null
        }
        Update: {
          api_key_id?: string | null
          created_at?: string | null
          endpoint?: string
          id?: string
          ip_address?: unknown
          response_status?: number | null
          response_time_ms?: number | null
          service_name?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'service_api_key_usage_api_key_id_fkey'
            columns: ['api_key_id']
            isOneToOne: false
            referencedRelation: 'service_api_keys'
            referencedColumns: ['id']
          },
        ]
      }
      service_api_keys: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          permissions: Json | null
          rate_limit_per_minute: number | null
          service_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          permissions?: Json | null
          rate_limit_per_minute?: number | null
          service_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          permissions?: Json | null
          rate_limit_per_minute?: number | null
          service_name?: string
          updated_at?: string | null
        }
        Relationships: []
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'session_activities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'session_activities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'session_activities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      session_timeout_configs: {
        Row: {
          auto_logout_timeout_minutes: number
          created_at: string | null
          enable_fullscreen_expiry_warning: boolean
          id: string
          is_global: boolean
          organization_id: string | null
          remember_me_duration_hours: number
          role: string
          session_timeout_minutes: number
          updated_at: string | null
          warning_time_minutes: number
        }
        Insert: {
          auto_logout_timeout_minutes?: number
          created_at?: string | null
          enable_fullscreen_expiry_warning?: boolean
          id?: string
          is_global?: boolean
          organization_id?: string | null
          remember_me_duration_hours?: number
          role: string
          session_timeout_minutes?: number
          updated_at?: string | null
          warning_time_minutes?: number
        }
        Update: {
          auto_logout_timeout_minutes?: number
          created_at?: string | null
          enable_fullscreen_expiry_warning?: boolean
          id?: string
          is_global?: boolean
          organization_id?: string | null
          remember_me_duration_hours?: number
          role?: string
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'settings_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'settings_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'settings_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_assignments_direct_supervisor_id_fkey'
            columns: ['direct_supervisor_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_assignments_direct_supervisor_id_fkey'
            columns: ['direct_supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_assignments_direct_supervisor_id_fkey'
            columns: ['direct_supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_direct_supervisor_id_fkey'
            columns: ['direct_supervisor_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_assignments_team_lead_id_fkey'
            columns: ['team_lead_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_assignments_team_lead_id_fkey'
            columns: ['team_lead_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_team_lead_id_fkey'
            columns: ['team_lead_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_positions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_positions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_positions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      shift_productivity_settings: {
        Row: {
          accuracy_threshold: number | null
          auto_archive: boolean | null
          auto_clock_out: boolean | null
          break_tracking: boolean | null
          calculation_method: string | null
          competitive_mode: boolean | null
          created_at: string | null
          cross_training_tracking: boolean | null
          daily_summary: boolean | null
          data_retention_days: number | null
          enable_advanced_analytics: boolean | null
          enable_debug_mode: boolean | null
          enable_kpi_tracking: boolean | null
          enable_notifications: boolean | null
          enable_team_tracking: boolean | null
          export_format: string | null
          id: string
          individual_metrics_visible: boolean | null
          low_productivity_alert: boolean | null
          organization_id: string
          quality_threshold: number | null
          shift_duration: string | null
          shift_end_reminder: boolean | null
          shift_rotation: string | null
          shift_start_reminder: boolean | null
          target_cycle_counts_per_hour: number | null
          target_missed_alert: boolean | null
          target_picks_per_hour: number | null
          target_putaways_per_hour: number | null
          target_scans_per_hour: number | null
          team_goals_visible: boolean | null
          team_milestone_notification: boolean | null
          team_size: number | null
          timezone: string | null
          tracking_enabled: boolean | null
          updated_at: string | null
        }
        Insert: {
          accuracy_threshold?: number | null
          auto_archive?: boolean | null
          auto_clock_out?: boolean | null
          break_tracking?: boolean | null
          calculation_method?: string | null
          competitive_mode?: boolean | null
          created_at?: string | null
          cross_training_tracking?: boolean | null
          daily_summary?: boolean | null
          data_retention_days?: number | null
          enable_advanced_analytics?: boolean | null
          enable_debug_mode?: boolean | null
          enable_kpi_tracking?: boolean | null
          enable_notifications?: boolean | null
          enable_team_tracking?: boolean | null
          export_format?: string | null
          id?: string
          individual_metrics_visible?: boolean | null
          low_productivity_alert?: boolean | null
          organization_id: string
          quality_threshold?: number | null
          shift_duration?: string | null
          shift_end_reminder?: boolean | null
          shift_rotation?: string | null
          shift_start_reminder?: boolean | null
          target_cycle_counts_per_hour?: number | null
          target_missed_alert?: boolean | null
          target_picks_per_hour?: number | null
          target_putaways_per_hour?: number | null
          target_scans_per_hour?: number | null
          team_goals_visible?: boolean | null
          team_milestone_notification?: boolean | null
          team_size?: number | null
          timezone?: string | null
          tracking_enabled?: boolean | null
          updated_at?: string | null
        }
        Update: {
          accuracy_threshold?: number | null
          auto_archive?: boolean | null
          auto_clock_out?: boolean | null
          break_tracking?: boolean | null
          calculation_method?: string | null
          competitive_mode?: boolean | null
          created_at?: string | null
          cross_training_tracking?: boolean | null
          daily_summary?: boolean | null
          data_retention_days?: number | null
          enable_advanced_analytics?: boolean | null
          enable_debug_mode?: boolean | null
          enable_kpi_tracking?: boolean | null
          enable_notifications?: boolean | null
          enable_team_tracking?: boolean | null
          export_format?: string | null
          id?: string
          individual_metrics_visible?: boolean | null
          low_productivity_alert?: boolean | null
          organization_id?: string
          quality_threshold?: number | null
          shift_duration?: string | null
          shift_end_reminder?: boolean | null
          shift_rotation?: string | null
          shift_start_reminder?: boolean | null
          target_cycle_counts_per_hour?: number | null
          target_missed_alert?: boolean | null
          target_picks_per_hour?: number | null
          target_putaways_per_hour?: number | null
          target_scans_per_hour?: number | null
          team_goals_visible?: boolean | null
          team_milestone_notification?: boolean | null
          team_size?: number | null
          timezone?: string | null
          tracking_enabled?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'shift_productivity_settings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: true
            referencedRelation: 'organizations'
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'shift_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'smartsheet_webhooks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'smartsheet_webhooks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'smartsheet_webhooks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      sqcdp_metric_history: {
        Row: {
          id: number
          metric_id: string
          note: string | null
          organization_id: string
          recorded_at: string
          source: string | null
          value: number
        }
        Insert: {
          id?: number
          metric_id: string
          note?: string | null
          organization_id: string
          recorded_at?: string
          source?: string | null
          value: number
        }
        Update: {
          id?: number
          metric_id?: string
          note?: string | null
          organization_id?: string
          recorded_at?: string
          source?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: 'sqcdp_metric_history_metric_id_fkey'
            columns: ['metric_id']
            isOneToOne: false
            referencedRelation: 'sqcdp_metrics'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sqcdp_metric_history_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      sqcdp_metrics: {
        Row: {
          accent_hex: string | null
          auto_value_config: Json
          category: string
          chart_config: Json
          chart_type: string
          color_hex: string | null
          created_at: string
          created_by: string | null
          current_value: number | null
          decimal_places: number | null
          display_order: number
          id: string
          is_visible: boolean
          lower_is_better: boolean
          notes: string | null
          organization_id: string
          show_markers: boolean
          show_trend: boolean
          style_config: Json
          sub_metrics: Json
          subtitle: string | null
          target_value: number | null
          title: string
          trend_period: Database['public']['Enums']['metric_trend_period']
          unit: string | null
          updated_at: string
          updated_by: string | null
          value_format: Database['public']['Enums']['metric_value_format']
          value_prefix: string | null
          value_suffix: string | null
        }
        Insert: {
          accent_hex?: string | null
          auto_value_config?: Json
          category: string
          chart_config?: Json
          chart_type?: string
          color_hex?: string | null
          created_at?: string
          created_by?: string | null
          current_value?: number | null
          decimal_places?: number | null
          display_order?: number
          id?: string
          is_visible?: boolean
          lower_is_better?: boolean
          notes?: string | null
          organization_id: string
          show_markers?: boolean
          show_trend?: boolean
          style_config?: Json
          sub_metrics?: Json
          subtitle?: string | null
          target_value?: number | null
          title: string
          trend_period?: Database['public']['Enums']['metric_trend_period']
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
          value_format?: Database['public']['Enums']['metric_value_format']
          value_prefix?: string | null
          value_suffix?: string | null
        }
        Update: {
          accent_hex?: string | null
          auto_value_config?: Json
          category?: string
          chart_config?: Json
          chart_type?: string
          color_hex?: string | null
          created_at?: string
          created_by?: string | null
          current_value?: number | null
          decimal_places?: number | null
          display_order?: number
          id?: string
          is_visible?: boolean
          lower_is_better?: boolean
          notes?: string | null
          organization_id?: string
          show_markers?: boolean
          show_trend?: boolean
          style_config?: Json
          sub_metrics?: Json
          subtitle?: string | null
          target_value?: number | null
          title?: string
          trend_period?: Database['public']['Enums']['metric_trend_period']
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
          value_format?: Database['public']['Enums']['metric_value_format']
          value_prefix?: string | null
          value_suffix?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'sqcdp_metrics_category_fk'
            columns: ['organization_id', 'category']
            isOneToOne: false
            referencedRelation: 'production_board_sqcdp_categories'
            referencedColumns: ['organization_id', 'slug']
          },
          {
            foreignKeyName: 'sqcdp_metrics_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sqcdp_metrics_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sqcdp_metrics_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sqcdp_metrics_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sqcdp_metrics_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sqcdp_metrics_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sqcdp_metrics_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sqcdp_metrics_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sqcdp_metrics_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      sqcdp_problems: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          notes: string | null
          organization_id: string
          reported_at: string
          reported_by: string | null
          resolved_at: string | null
          severity: Database['public']['Enums']['post_severity']
          status: Database['public']['Enums']['sqcdp_problem_status']
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category: string
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          reported_at?: string
          reported_by?: string | null
          resolved_at?: string | null
          severity?: Database['public']['Enums']['post_severity']
          status?: Database['public']['Enums']['sqcdp_problem_status']
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          reported_at?: string
          reported_by?: string | null
          resolved_at?: string | null
          severity?: Database['public']['Enums']['post_severity']
          status?: Database['public']['Enums']['sqcdp_problem_status']
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sqcdp_problems_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sqcdp_problems_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sqcdp_problems_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sqcdp_problems_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sqcdp_problems_category_fk'
            columns: ['organization_id', 'category']
            isOneToOne: false
            referencedRelation: 'production_board_sqcdp_categories'
            referencedColumns: ['organization_id', 'slug']
          },
          {
            foreignKeyName: 'sqcdp_problems_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sqcdp_problems_reported_by_fkey'
            columns: ['reported_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sqcdp_problems_reported_by_fkey'
            columns: ['reported_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'sqcdp_problems_reported_by_fkey'
            columns: ['reported_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sqcdp_problems_reported_by_fkey'
            columns: ['reported_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_audit_log_performed_by_fkey'
            columns: ['performed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_audit_log_performed_by_fkey'
            columns: ['performed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_audit_log_performed_by_fkey'
            columns: ['performed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_items_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_items_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_items_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_submissions_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_submissions_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_submissions_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_submissions_submitted_by_fkey'
            columns: ['submitted_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_submissions_submitted_by_fkey'
            columns: ['submitted_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_submissions_submitted_by_fkey'
            columns: ['submitted_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_submissions_submitted_by_fkey'
            columns: ['submitted_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      standard_work_template_assignments: {
        Row: {
          assigned_by: string | null
          assignment_type: string
          created_at: string
          effective_from: string | null
          effective_to: string | null
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          position_id: string | null
          priority: number
          template_id: string
          updated_at: string
          user_id: string | null
          working_area_id: string | null
        }
        Insert: {
          assigned_by?: string | null
          assignment_type?: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          position_id?: string | null
          priority?: number
          template_id: string
          updated_at?: string
          user_id?: string | null
          working_area_id?: string | null
        }
        Update: {
          assigned_by?: string | null
          assignment_type?: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          position_id?: string | null
          priority?: number
          template_id?: string
          updated_at?: string
          user_id?: string | null
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'standard_work_template_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_position_id_fkey'
            columns: ['position_id']
            isOneToOne: false
            referencedRelation: 'shift_positions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'standard_work_templates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_template_assignments_working_area_id_fkey'
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'standard_work_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      supervisor_pin_failures: {
        Row: {
          attempted_by: string | null
          failed_at: string
          id: number
          organization_id: string | null
          reason: string | null
          task_id: string | null
          user_id: string | null
        }
        Insert: {
          attempted_by?: string | null
          failed_at?: string
          id?: number
          organization_id?: string | null
          reason?: string | null
          task_id?: string | null
          user_id?: string | null
        }
        Update: {
          attempted_by?: string | null
          failed_at?: string
          id?: number
          organization_id?: string | null
          reason?: string | null
          task_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'supervisor_pin_failures_attempted_by_fkey'
            columns: ['attempted_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'supervisor_pin_failures_attempted_by_fkey'
            columns: ['attempted_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'supervisor_pin_failures_attempted_by_fkey'
            columns: ['attempted_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supervisor_pin_failures_attempted_by_fkey'
            columns: ['attempted_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'supervisor_pin_failures_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supervisor_pin_failures_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'supervisor_pin_failures_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'supervisor_pin_failures_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supervisor_pin_failures_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      supervisor_pins: {
        Row: {
          pin_hash: string
          set_at: string
          set_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          pin_hash: string
          set_at?: string
          set_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          pin_hash?: string
          set_at?: string
          set_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'supervisor_pins_set_by_fkey'
            columns: ['set_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'supervisor_pins_set_by_fkey'
            columns: ['set_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'supervisor_pins_set_by_fkey'
            columns: ['set_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supervisor_pins_set_by_fkey'
            columns: ['set_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'supervisor_pins_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'supervisor_pins_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'supervisor_pins_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supervisor_pins_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'support_tickets_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'support_tickets_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_tickets_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'support_tickets_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'support_tickets_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'support_tickets_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_tickets_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'support_tickets_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'support_tickets_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'support_tickets_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_tickets_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'support_tickets_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'support_tickets_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_tickets_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      task_artifacts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          meta: Json
          mime: string | null
          organization_id: string
          size_bytes: number | null
          storage_path: string | null
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          meta?: Json
          mime?: string | null
          organization_id: string
          size_bytes?: number | null
          storage_path?: string | null
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          meta?: Json
          mime?: string | null
          organization_id?: string
          size_bytes?: number | null
          storage_path?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'task_artifacts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'task_artifacts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'task_artifacts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_artifacts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'task_artifacts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_artifacts_task_org_fk'
            columns: ['organization_id', 'task_id']
            isOneToOne: false
            referencedRelation: 'work_tasks'
            referencedColumns: ['organization_id', 'id']
          },
        ]
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'task_assignment_history_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'task_assignment_history_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_assignment_history_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
          slug: string
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
          slug: string
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
          slug?: string
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tasks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tasks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tasks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'temporary_role_assignments_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'temporary_role_assignments_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'temporary_role_assignments_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'temporary_role_assignments_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'role_permission_summary'
            referencedColumns: ['role_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'temporary_role_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'temporary_role_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'temporary_role_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_assignments_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_assignments_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_assignments_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_assignments_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_assignments_unassigned_by_fkey'
            columns: ['unassigned_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_assignments_unassigned_by_fkey'
            columns: ['unassigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_assignments_unassigned_by_fkey'
            columns: ['unassigned_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_attachments_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_attachments_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_attachments_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_comments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_comments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_comments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_history_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_history_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_history_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_messages_sender_id_fkey'
            columns: ['sender_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'ticket_messages_sender_id_fkey'
            columns: ['sender_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_messages_sender_id_fkey'
            columns: ['sender_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      ticket_user_actions: {
        Row: {
          action_type: string
          created_at: string | null
          details: Json | null
          id: string
          organization_id: string
          response_time_ms: number | null
          ticket_row_id: number
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string | null
          details?: Json | null
          id?: string
          organization_id: string
          response_time_ms?: number | null
          ticket_row_id: number
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          organization_id?: string
          response_time_ms?: number | null
          ticket_row_id?: number
          user_id?: string
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_last_response_by_fkey'
            columns: ['last_response_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_last_response_by_fkey'
            columns: ['last_response_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_last_response_by_fkey'
            columns: ['last_response_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_last_response_by_fkey'
            columns: ['last_response_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'tickets_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      time_adjustment_note_history: {
        Row: {
          created_at: string
          edited_by_name: string
          edited_by_user_id: string
          id: string
          note_content: string
          previous_content: string | null
          request_id: string
        }
        Insert: {
          created_at?: string
          edited_by_name: string
          edited_by_user_id: string
          id?: string
          note_content: string
          previous_content?: string | null
          request_id: string
        }
        Update: {
          created_at?: string
          edited_by_name?: string
          edited_by_user_id?: string
          id?: string
          note_content?: string
          previous_content?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'time_adjustment_note_history_request_id_fkey'
            columns: ['request_id']
            isOneToOne: false
            referencedRelation: 'time_adjustment_requests'
            referencedColumns: ['id']
          },
        ]
      }
      time_adjustment_requests: {
        Row: {
          clock_code: string
          correction_type: string
          created_at: string
          department_area: string | null
          hours_requested: number | null
          id: string
          notes: string | null
          organization_id: string
          reason_code: string
          reason_other: string | null
          request_date: string
          requester_badge: string
          requester_name: string
          requester_user_id: string
          reviewed_at: string | null
          reviewer_name: string | null
          reviewer_notes: string | null
          reviewer_user_id: string | null
          signature_data_url: string
          status: string
          supervisor_name: string | null
          updated_at: string
        }
        Insert: {
          clock_code: string
          correction_type: string
          created_at?: string
          department_area?: string | null
          hours_requested?: number | null
          id?: string
          notes?: string | null
          organization_id: string
          reason_code: string
          reason_other?: string | null
          request_date: string
          requester_badge: string
          requester_name: string
          requester_user_id: string
          reviewed_at?: string | null
          reviewer_name?: string | null
          reviewer_notes?: string | null
          reviewer_user_id?: string | null
          signature_data_url: string
          status?: string
          supervisor_name?: string | null
          updated_at?: string
        }
        Update: {
          clock_code?: string
          correction_type?: string
          created_at?: string
          department_area?: string | null
          hours_requested?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          reason_code?: string
          reason_other?: string | null
          request_date?: string
          requester_badge?: string
          requester_name?: string
          requester_user_id?: string
          reviewed_at?: string | null
          reviewer_name?: string | null
          reviewer_notes?: string | null
          reviewer_user_id?: string | null
          signature_data_url?: string
          status?: string
          supervisor_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'time_adjustment_requests_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      time_card_notes: {
        Row: {
          author_id: string
          content: string
          created_at: string | null
          id: string
          note_type: Database['public']['Enums']['time_card_note_type']
          related_clock_entry_id: string | null
          time_card_id: string
          updated_at: string | null
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string | null
          id?: string
          note_type?: Database['public']['Enums']['time_card_note_type']
          related_clock_entry_id?: string | null
          time_card_id: string
          updated_at?: string | null
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string | null
          id?: string
          note_type?: Database['public']['Enums']['time_card_note_type']
          related_clock_entry_id?: string | null
          time_card_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'time_card_notes_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_card_notes_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_card_notes_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_card_notes_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_card_notes_related_clock_entry_id_fkey'
            columns: ['related_clock_entry_id']
            isOneToOne: false
            referencedRelation: 'time_clock_entries'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_card_notes_time_card_id_fkey'
            columns: ['time_card_id']
            isOneToOne: false
            referencedRelation: 'time_cards'
            referencedColumns: ['id']
          },
        ]
      }
      time_cards: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          employee_notes: string | null
          exceptions_count: number | null
          id: string
          organization_id: string
          pay_period_end: string
          pay_period_start: string
          rejected_at: string | null
          rejected_by: string | null
          shift_assignment_id: string | null
          status: Database['public']['Enums']['time_card_status']
          submitted_at: string | null
          supervisor_notes: string | null
          total_break_hours: number | null
          total_double_time_hours: number | null
          total_overtime_hours: number | null
          total_pto_hours: number | null
          total_regular_hours: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          employee_notes?: string | null
          exceptions_count?: number | null
          id?: string
          organization_id: string
          pay_period_end: string
          pay_period_start: string
          rejected_at?: string | null
          rejected_by?: string | null
          shift_assignment_id?: string | null
          status?: Database['public']['Enums']['time_card_status']
          submitted_at?: string | null
          supervisor_notes?: string | null
          total_break_hours?: number | null
          total_double_time_hours?: number | null
          total_overtime_hours?: number | null
          total_pto_hours?: number | null
          total_regular_hours?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          employee_notes?: string | null
          exceptions_count?: number | null
          id?: string
          organization_id?: string
          pay_period_end?: string
          pay_period_start?: string
          rejected_at?: string | null
          rejected_by?: string | null
          shift_assignment_id?: string | null
          status?: Database['public']['Enums']['time_card_status']
          submitted_at?: string | null
          supervisor_notes?: string | null
          total_break_hours?: number | null
          total_double_time_hours?: number | null
          total_overtime_hours?: number | null
          total_pto_hours?: number | null
          total_regular_hours?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'time_cards_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_cards_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_cards_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_cards_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_cards_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_cards_rejected_by_fkey'
            columns: ['rejected_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_cards_rejected_by_fkey'
            columns: ['rejected_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_cards_rejected_by_fkey'
            columns: ['rejected_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_cards_rejected_by_fkey'
            columns: ['rejected_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_cards_shift_assignment_id_fkey'
            columns: ['shift_assignment_id']
            isOneToOne: false
            referencedRelation: 'shift_assignments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_cards_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_cards_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_cards_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_cards_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      time_clock_entries: {
        Row: {
          badge_number: string | null
          break_duration_minutes: number | null
          clock_in: string
          clock_in_method: Database['public']['Enums']['clock_entry_method']
          clock_in_photo_url: string | null
          clock_out: string | null
          clock_out_photo_url: string | null
          created_at: string | null
          device_info: string | null
          id: string
          ip_address: string | null
          is_manual_entry: boolean
          manual_entered_by: string | null
          manual_entry_reason: string | null
          notes: string | null
          organization_id: string
          shift_assignment_id: string | null
          status: Database['public']['Enums']['clock_entry_status']
          updated_at: string | null
          user_id: string
        }
        Insert: {
          badge_number?: string | null
          break_duration_minutes?: number | null
          clock_in?: string
          clock_in_method?: Database['public']['Enums']['clock_entry_method']
          clock_in_photo_url?: string | null
          clock_out?: string | null
          clock_out_photo_url?: string | null
          created_at?: string | null
          device_info?: string | null
          id?: string
          ip_address?: string | null
          is_manual_entry?: boolean
          manual_entered_by?: string | null
          manual_entry_reason?: string | null
          notes?: string | null
          organization_id: string
          shift_assignment_id?: string | null
          status?: Database['public']['Enums']['clock_entry_status']
          updated_at?: string | null
          user_id: string
        }
        Update: {
          badge_number?: string | null
          break_duration_minutes?: number | null
          clock_in?: string
          clock_in_method?: Database['public']['Enums']['clock_entry_method']
          clock_in_photo_url?: string | null
          clock_out?: string | null
          clock_out_photo_url?: string | null
          created_at?: string | null
          device_info?: string | null
          id?: string
          ip_address?: string | null
          is_manual_entry?: boolean
          manual_entered_by?: string | null
          manual_entry_reason?: string | null
          notes?: string | null
          organization_id?: string
          shift_assignment_id?: string | null
          status?: Database['public']['Enums']['clock_entry_status']
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'time_clock_entries_manual_entered_by_fkey'
            columns: ['manual_entered_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_clock_entries_manual_entered_by_fkey'
            columns: ['manual_entered_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_clock_entries_manual_entered_by_fkey'
            columns: ['manual_entered_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_clock_entries_manual_entered_by_fkey'
            columns: ['manual_entered_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_clock_entries_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_clock_entries_shift_assignment_id_fkey'
            columns: ['shift_assignment_id']
            isOneToOne: false
            referencedRelation: 'shift_assignments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_clock_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_clock_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'time_clock_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'time_clock_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'timeline_event_acknowledgments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'timeline_event_acknowledgments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timeline_event_acknowledgments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'timeline_event_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'timeline_event_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timeline_event_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'timeline_events_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'timeline_events_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timeline_events_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            foreignKeyName: 'user_permissions_permission_id_fkey'
            columns: ['permission_id']
            isOneToOne: false
            referencedRelation: 'permissions_with_metadata'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'user_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'user_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'role_permission_summary'
            referencedColumns: ['role_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'user_sessions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'user_sessions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_sessions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'user_status_history_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'user_status_history_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_status_history_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            foreignKeyName: 'user_tab_permissions_tab_definition_id_fkey'
            columns: ['tab_definition_id']
            isOneToOne: false
            referencedRelation: 'tab_permissions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_tab_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'user_tab_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'user_tab_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_tab_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      warehouse_aisle_edges: {
        Row: {
          cost: number
          created_at: string
          from_node_id: string
          id: string
          is_elevator: boolean
          is_stair: boolean
          map_id: string
          metadata: Json | null
          one_way: boolean
          organization_id: string
          to_node_id: string
        }
        Insert: {
          cost?: number
          created_at?: string
          from_node_id: string
          id?: string
          is_elevator?: boolean
          is_stair?: boolean
          map_id: string
          metadata?: Json | null
          one_way?: boolean
          organization_id: string
          to_node_id: string
        }
        Update: {
          cost?: number
          created_at?: string
          from_node_id?: string
          id?: string
          is_elevator?: boolean
          is_stair?: boolean
          map_id?: string
          metadata?: Json | null
          one_way?: boolean
          organization_id?: string
          to_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_aisle_edges_from_node_id_fkey'
            columns: ['from_node_id']
            isOneToOne: false
            referencedRelation: 'warehouse_aisle_nodes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_aisle_edges_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_aisle_edges_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_aisle_edges_to_node_id_fkey'
            columns: ['to_node_id']
            isOneToOne: false
            referencedRelation: 'warehouse_aisle_nodes'
            referencedColumns: ['id']
          },
        ]
      }
      warehouse_aisle_nodes: {
        Row: {
          created_at: string
          floor_level: number
          id: string
          kind: Database['public']['Enums']['warehouse_aisle_node_kind']
          label: string | null
          map_id: string
          metadata: Json | null
          organization_id: string
          updated_at: string
          x: number
          y: number
        }
        Insert: {
          created_at?: string
          floor_level?: number
          id?: string
          kind?: Database['public']['Enums']['warehouse_aisle_node_kind']
          label?: string | null
          map_id: string
          metadata?: Json | null
          organization_id: string
          updated_at?: string
          x: number
          y: number
        }
        Update: {
          created_at?: string
          floor_level?: number
          id?: string
          kind?: Database['public']['Enums']['warehouse_aisle_node_kind']
          label?: string | null
          map_id?: string
          metadata?: Json | null
          organization_id?: string
          updated_at?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_aisle_nodes_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_aisle_nodes_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      warehouse_asset_position_latest: {
        Row: {
          asset_id: string
          floor_level: number
          heading_deg: number | null
          map_id: string
          metadata: Json | null
          observed_at: string
          organization_id: string
          source: string | null
          speed_mps: number | null
          x: number
          y: number
        }
        Insert: {
          asset_id: string
          floor_level?: number
          heading_deg?: number | null
          map_id: string
          metadata?: Json | null
          observed_at: string
          organization_id: string
          source?: string | null
          speed_mps?: number | null
          x: number
          y: number
        }
        Update: {
          asset_id?: string
          floor_level?: number
          heading_deg?: number | null
          map_id?: string
          metadata?: Json | null
          observed_at?: string
          organization_id?: string
          source?: string | null
          speed_mps?: number | null
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_asset_position_latest_asset_id_fkey'
            columns: ['asset_id']
            isOneToOne: true
            referencedRelation: 'warehouse_assets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_asset_position_latest_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_asset_position_latest_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      warehouse_asset_positions: {
        Row: {
          asset_id: string
          floor_level: number
          heading_deg: number | null
          id: string
          map_id: string
          metadata: Json | null
          observed_at: string
          organization_id: string
          source: string
          speed_mps: number | null
          x: number
          y: number
        }
        Insert: {
          asset_id: string
          floor_level?: number
          heading_deg?: number | null
          id?: string
          map_id: string
          metadata?: Json | null
          observed_at?: string
          organization_id: string
          source?: string
          speed_mps?: number | null
          x: number
          y: number
        }
        Update: {
          asset_id?: string
          floor_level?: number
          heading_deg?: number | null
          id?: string
          map_id?: string
          metadata?: Json | null
          observed_at?: string
          organization_id?: string
          source?: string
          speed_mps?: number | null
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_asset_positions_asset_id_fkey'
            columns: ['asset_id']
            isOneToOne: false
            referencedRelation: 'warehouse_assets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_asset_positions_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_asset_positions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      warehouse_assets: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          display_name: string
          external_id: string | null
          id: string
          kind: Database['public']['Enums']['warehouse_asset_kind']
          map_id: string
          metadata: Json | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          display_name: string
          external_id?: string | null
          id?: string
          kind?: Database['public']['Enums']['warehouse_asset_kind']
          map_id: string
          metadata?: Json | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          display_name?: string
          external_id?: string | null
          id?: string
          kind?: Database['public']['Enums']['warehouse_asset_kind']
          map_id?: string
          metadata?: Json | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_assets_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_assets_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      warehouse_auto_map_runs: {
        Row: {
          applied_assignments: Json
          completed_at: string | null
          conflicts: Json
          error_message: string | null
          id: string
          map_id: string
          organization_id: string
          proposed_assignments: Json
          requested_area: string | null
          requested_by: string | null
          started_at: string
          status: Database['public']['Enums']['warehouse_auto_map_status']
          warehouse_code: string
          warnings: Json
        }
        Insert: {
          applied_assignments?: Json
          completed_at?: string | null
          conflicts?: Json
          error_message?: string | null
          id?: string
          map_id: string
          organization_id: string
          proposed_assignments?: Json
          requested_area?: string | null
          requested_by?: string | null
          started_at?: string
          status?: Database['public']['Enums']['warehouse_auto_map_status']
          warehouse_code: string
          warnings?: Json
        }
        Update: {
          applied_assignments?: Json
          completed_at?: string | null
          conflicts?: Json
          error_message?: string | null
          id?: string
          map_id?: string
          organization_id?: string
          proposed_assignments?: Json
          requested_area?: string | null
          requested_by?: string | null
          started_at?: string
          status?: Database['public']['Enums']['warehouse_auto_map_status']
          warehouse_code?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_auto_map_runs_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_auto_map_runs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_auto_map_runs_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_auto_map_runs_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_auto_map_runs_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_auto_map_runs_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      warehouse_location_mappings: {
        Row: {
          created_at: string
          id: string
          map_id: string
          metadata: Json | null
          nearest_node_id: string | null
          operational_status: Database['public']['Enums']['warehouse_operational_status']
          organization_id: string
          rack_column: number
          rack_id: string
          rack_row: number
          status_changed_at: string | null
          status_changed_by: string | null
          status_reason: string | null
          storage_bin: string
          updated_at: string
          warehouse_code: string
        }
        Insert: {
          created_at?: string
          id?: string
          map_id: string
          metadata?: Json | null
          nearest_node_id?: string | null
          operational_status?: Database['public']['Enums']['warehouse_operational_status']
          organization_id: string
          rack_column: number
          rack_id: string
          rack_row: number
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_reason?: string | null
          storage_bin: string
          updated_at?: string
          warehouse_code: string
        }
        Update: {
          created_at?: string
          id?: string
          map_id?: string
          metadata?: Json | null
          nearest_node_id?: string | null
          operational_status?: Database['public']['Enums']['warehouse_operational_status']
          organization_id?: string
          rack_column?: number
          rack_id?: string
          rack_row?: number
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_reason?: string | null
          storage_bin?: string
          updated_at?: string
          warehouse_code?: string
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_location_mappings_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_location_mappings_nearest_node_id_fkey'
            columns: ['nearest_node_id']
            isOneToOne: false
            referencedRelation: 'warehouse_aisle_nodes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_location_mappings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_location_mappings_rack_id_fkey'
            columns: ['rack_id']
            isOneToOne: false
            referencedRelation: 'warehouse_racks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_location_mappings_status_changed_by_fkey'
            columns: ['status_changed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_location_mappings_status_changed_by_fkey'
            columns: ['status_changed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_location_mappings_status_changed_by_fkey'
            columns: ['status_changed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_location_mappings_status_changed_by_fkey'
            columns: ['status_changed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      warehouse_location_status_log: {
        Row: {
          changed_at: string
          changed_by: string
          id: string
          mapping_id: string
          new_status: Database['public']['Enums']['warehouse_operational_status']
          old_status:
            | Database['public']['Enums']['warehouse_operational_status']
            | null
          organization_id: string
          reason: string | null
        }
        Insert: {
          changed_at?: string
          changed_by: string
          id?: string
          mapping_id: string
          new_status: Database['public']['Enums']['warehouse_operational_status']
          old_status?:
            | Database['public']['Enums']['warehouse_operational_status']
            | null
          organization_id: string
          reason?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string
          id?: string
          mapping_id?: string
          new_status?: Database['public']['Enums']['warehouse_operational_status']
          old_status?:
            | Database['public']['Enums']['warehouse_operational_status']
            | null
          organization_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_location_status_log_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_location_status_log_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_location_status_log_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_location_status_log_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_location_status_log_mapping_id_fkey'
            columns: ['mapping_id']
            isOneToOne: false
            referencedRelation: 'warehouse_location_mappings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_location_status_log_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      warehouse_map_background_assets: {
        Row: {
          archived_at: string | null
          content_hash: string | null
          file_size_bytes: number | null
          height: number | null
          id: string
          is_active: boolean
          map_id: string
          mime_type: string
          organization_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
          version_number: number
          width: number | null
        }
        Insert: {
          archived_at?: string | null
          content_hash?: string | null
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          is_active?: boolean
          map_id: string
          mime_type?: string
          organization_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
          version_number?: number
          width?: number | null
        }
        Update: {
          archived_at?: string | null
          content_hash?: string | null
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          is_active?: boolean
          map_id?: string
          mime_type?: string
          organization_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
          version_number?: number
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_map_background_assets_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_map_background_assets_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_map_background_assets_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_map_background_assets_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_map_background_assets_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_map_background_assets_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      warehouse_map_revisions: {
        Row: {
          change_summary: string | null
          created_at: string
          created_by: string | null
          id: string
          map_id: string
          organization_id: string
          published_at: string | null
          published_by: string | null
          rolled_back_from_revision_id: string | null
          snapshot_json: Json
          status: Database['public']['Enums']['warehouse_revision_status']
          version_number: number
        }
        Insert: {
          change_summary?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          map_id: string
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          rolled_back_from_revision_id?: string | null
          snapshot_json?: Json
          status?: Database['public']['Enums']['warehouse_revision_status']
          version_number?: number
        }
        Update: {
          change_summary?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          map_id?: string
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          rolled_back_from_revision_id?: string | null
          snapshot_json?: Json
          status?: Database['public']['Enums']['warehouse_revision_status']
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_map_revisions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_map_revisions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_map_revisions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_map_revisions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_map_revisions_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_map_revisions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_map_revisions_published_by_fkey'
            columns: ['published_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_map_revisions_published_by_fkey'
            columns: ['published_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_map_revisions_published_by_fkey'
            columns: ['published_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_map_revisions_published_by_fkey'
            columns: ['published_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_map_revisions_rolled_back_from_revision_id_fkey'
            columns: ['rolled_back_from_revision_id']
            isOneToOne: false
            referencedRelation: 'warehouse_map_revisions'
            referencedColumns: ['id']
          },
        ]
      }
      warehouse_map_settings: {
        Row: {
          allow_layout_edits: boolean
          allow_status_changes: boolean
          default_warehouse_code: string | null
          enabled: boolean
          fallback_mode: Database['public']['Enums']['warehouse_fallback_mode']
          id: string
          live_updates_enabled: boolean
          organization_id: string
          read_only_mode: boolean
          show_3d_viewer: boolean
          stale_after_minutes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_layout_edits?: boolean
          allow_status_changes?: boolean
          default_warehouse_code?: string | null
          enabled?: boolean
          fallback_mode?: Database['public']['Enums']['warehouse_fallback_mode']
          id?: string
          live_updates_enabled?: boolean
          organization_id: string
          read_only_mode?: boolean
          show_3d_viewer?: boolean
          stale_after_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_layout_edits?: boolean
          allow_status_changes?: boolean
          default_warehouse_code?: string | null
          enabled?: boolean
          fallback_mode?: Database['public']['Enums']['warehouse_fallback_mode']
          id?: string
          live_updates_enabled?: boolean
          organization_id?: string
          read_only_mode?: boolean
          show_3d_viewer?: boolean
          stale_after_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_map_settings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_map_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_map_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_map_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_map_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      warehouse_maps: {
        Row: {
          active_background_asset_id: string | null
          active_revision_id: string | null
          building_outline: Json | null
          canvas_settings: Json
          created_at: string
          created_by: string | null
          grid_settings: Json
          id: string
          is_default: boolean
          name: string
          organization_id: string
          published_at: string | null
          published_by: string | null
          scale_factor: number
          updated_at: string
          warehouse_code: string
        }
        Insert: {
          active_background_asset_id?: string | null
          active_revision_id?: string | null
          building_outline?: Json | null
          canvas_settings?: Json
          created_at?: string
          created_by?: string | null
          grid_settings?: Json
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          scale_factor?: number
          updated_at?: string
          warehouse_code: string
        }
        Update: {
          active_background_asset_id?: string | null
          active_revision_id?: string | null
          building_outline?: Json | null
          canvas_settings?: Json
          created_at?: string
          created_by?: string | null
          grid_settings?: Json
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          scale_factor?: number
          updated_at?: string
          warehouse_code?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_active_background'
            columns: ['active_background_asset_id']
            isOneToOne: false
            referencedRelation: 'warehouse_map_background_assets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_active_revision'
            columns: ['active_revision_id']
            isOneToOne: false
            referencedRelation: 'warehouse_map_revisions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_maps_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_maps_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_maps_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_maps_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_maps_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_maps_published_by_fkey'
            columns: ['published_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_maps_published_by_fkey'
            columns: ['published_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'warehouse_maps_published_by_fkey'
            columns: ['published_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_maps_published_by_fkey'
            columns: ['published_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      warehouse_racks: {
        Row: {
          aisle: string | null
          columns: number
          created_at: string
          height: number
          id: string
          label: string
          map_id: string
          metadata: Json | null
          organization_id: string
          position_x: number
          position_y: number
          rack_type: string
          rotation: number
          rows: number
          updated_at: string
          width: number
          zone_id: string | null
        }
        Insert: {
          aisle?: string | null
          columns?: number
          created_at?: string
          height?: number
          id?: string
          label: string
          map_id: string
          metadata?: Json | null
          organization_id: string
          position_x?: number
          position_y?: number
          rack_type?: string
          rotation?: number
          rows?: number
          updated_at?: string
          width?: number
          zone_id?: string | null
        }
        Update: {
          aisle?: string | null
          columns?: number
          created_at?: string
          height?: number
          id?: string
          label?: string
          map_id?: string
          metadata?: Json | null
          organization_id?: string
          position_x?: number
          position_y?: number
          rack_type?: string
          rotation?: number
          rows?: number
          updated_at?: string
          width?: number
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_racks_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_racks_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_racks_zone_id_fkey'
            columns: ['zone_id']
            isOneToOne: false
            referencedRelation: 'warehouse_zones'
            referencedColumns: ['id']
          },
        ]
      }
      warehouse_zones: {
        Row: {
          color: string
          created_at: string
          floor_level: number
          id: string
          map_id: string
          name: string
          opacity: number
          organization_id: string
          polygon: Json
          sort_order: number
          updated_at: string
          zone_type: string
        }
        Insert: {
          color?: string
          created_at?: string
          floor_level?: number
          id?: string
          map_id: string
          name: string
          opacity?: number
          organization_id: string
          polygon?: Json
          sort_order?: number
          updated_at?: string
          zone_type?: string
        }
        Update: {
          color?: string
          created_at?: string
          floor_level?: number
          id?: string
          map_id?: string
          name?: string
          opacity?: number
          organization_id?: string
          polygon?: Json
          sort_order?: number
          updated_at?: string
          zone_type?: string
        }
        Relationships: [
          {
            foreignKeyName: 'warehouse_zones_map_id_fkey'
            columns: ['map_id']
            isOneToOne: false
            referencedRelation: 'warehouse_maps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'warehouse_zones_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      work_engine_backfill_progress: {
        Row: {
          finished_at: string | null
          last_cursor_id: string | null
          last_cursor_ts: string | null
          notes: string | null
          organization_id: string
          rows_inserted: number
          started_at: string
        }
        Insert: {
          finished_at?: string | null
          last_cursor_id?: string | null
          last_cursor_ts?: string | null
          notes?: string | null
          organization_id: string
          rows_inserted?: number
          started_at?: string
        }
        Update: {
          finished_at?: string | null
          last_cursor_id?: string | null
          last_cursor_ts?: string | null
          notes?: string | null
          organization_id?: string
          rows_inserted?: number
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'work_engine_backfill_progress_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      work_engine_backfill_report: {
        Row: {
          drift_count: number | null
          id: string
          legacy_count: number | null
          organization_id: string
          payload: Json
          ran_at: string
          work_count: number | null
        }
        Insert: {
          drift_count?: number | null
          id?: string
          legacy_count?: number | null
          organization_id: string
          payload?: Json
          ran_at?: string
          work_count?: number | null
        }
        Update: {
          drift_count?: number | null
          id?: string
          legacy_count?: number | null
          organization_id?: string
          payload?: Json
          ran_at?: string
          work_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'work_engine_backfill_report_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      work_engine_settings: {
        Row: {
          created_at: string
          created_by: string | null
          default_strategy_overrides: Json
          enabled_work_types: string[]
          feature_flags: Json
          notes: string | null
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_strategy_overrides?: Json
          enabled_work_types?: string[]
          feature_flags?: Json
          notes?: string | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_strategy_overrides?: Json
          enabled_work_types?: string[]
          feature_flags?: Json
          notes?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'work_engine_settings_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_engine_settings_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_engine_settings_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_engine_settings_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_engine_settings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_engine_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_engine_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_engine_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_engine_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      work_events: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          at: string
          event_type: string
          id: string
          organization_id: string
          payload: Json
          task_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          at?: string
          event_type: string
          id?: string
          organization_id: string
          payload?: Json
          task_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          at?: string
          event_type?: string
          id?: string
          organization_id?: string
          payload?: Json
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'work_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_events_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_events_task_org_fk'
            columns: ['organization_id', 'task_id']
            isOneToOne: false
            referencedRelation: 'work_tasks'
            referencedColumns: ['organization_id', 'id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_queue_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_queue_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_queue_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_queue_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_queue_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_queue_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_queue_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      work_request_idempotency: {
        Row: {
          created_at: string
          expires_at: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          response_body: Json | null
          route: string
          status_code: number | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          response_body?: Json | null
          route: string
          status_code?: number | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          idempotency_key?: string
          organization_id?: string
          request_hash?: string
          response_body?: Json | null
          route?: string
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'work_request_idempotency_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      work_tasks: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          dispatch_zone: string | null
          due_date: string | null
          escalation_history: Json
          escalation_level: number
          id: string
          idempotency_key: string | null
          legacy_status: string | null
          organization_id: string
          payload: Json
          payload_version: number
          primary_location: string | null
          priority: string
          push_acknowledged: boolean
          push_acknowledged_at: string | null
          push_mode: string
          pushed_at: string | null
          pushed_by: string | null
          reservation_started_at: string | null
          resolution_source: string | null
          resolved_aisle: string | null
          resolved_sequence: number | null
          resolved_zone: string | null
          result_payload: Json | null
          secondary_location: string | null
          source_id: string | null
          source_table: string | null
          started_at: string | null
          status: string
          subject_description: string | null
          subject_material: string | null
          supervisor_assigned_at: string | null
          supervisor_assigned_by: string | null
          task_number: string | null
          task_subtype: string | null
          task_type: string
          unit_of_measure: string | null
          updated_at: string
          warehouse: string | null
          workflow_config_id: string | null
          workflow_config_version: number | null
          workflow_snapshot: Json | null
          zone: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          dispatch_zone?: string | null
          due_date?: string | null
          escalation_history?: Json
          escalation_level?: number
          id?: string
          idempotency_key?: string | null
          legacy_status?: string | null
          organization_id: string
          payload?: Json
          payload_version?: number
          primary_location?: string | null
          priority?: string
          push_acknowledged?: boolean
          push_acknowledged_at?: string | null
          push_mode?: string
          pushed_at?: string | null
          pushed_by?: string | null
          reservation_started_at?: string | null
          resolution_source?: string | null
          resolved_aisle?: string | null
          resolved_sequence?: number | null
          resolved_zone?: string | null
          result_payload?: Json | null
          secondary_location?: string | null
          source_id?: string | null
          source_table?: string | null
          started_at?: string | null
          status?: string
          subject_description?: string | null
          subject_material?: string | null
          supervisor_assigned_at?: string | null
          supervisor_assigned_by?: string | null
          task_number?: string | null
          task_subtype?: string | null
          task_type: string
          unit_of_measure?: string | null
          updated_at?: string
          warehouse?: string | null
          workflow_config_id?: string | null
          workflow_config_version?: number | null
          workflow_snapshot?: Json | null
          zone?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          dispatch_zone?: string | null
          due_date?: string | null
          escalation_history?: Json
          escalation_level?: number
          id?: string
          idempotency_key?: string | null
          legacy_status?: string | null
          organization_id?: string
          payload?: Json
          payload_version?: number
          primary_location?: string | null
          priority?: string
          push_acknowledged?: boolean
          push_acknowledged_at?: string | null
          push_mode?: string
          pushed_at?: string | null
          pushed_by?: string | null
          reservation_started_at?: string | null
          resolution_source?: string | null
          resolved_aisle?: string | null
          resolved_sequence?: number | null
          resolved_zone?: string | null
          result_payload?: Json | null
          secondary_location?: string | null
          source_id?: string | null
          source_table?: string | null
          started_at?: string | null
          status?: string
          subject_description?: string | null
          subject_material?: string | null
          supervisor_assigned_at?: string | null
          supervisor_assigned_by?: string | null
          task_number?: string | null
          task_subtype?: string | null
          task_type?: string
          unit_of_measure?: string | null
          updated_at?: string
          warehouse?: string | null
          workflow_config_id?: string | null
          workflow_config_version?: number | null
          workflow_snapshot?: Json | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'work_tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_tasks_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_tasks_organization_id_task_type_fkey'
            columns: ['organization_id', 'task_type']
            isOneToOne: false
            referencedRelation: 'task_types'
            referencedColumns: ['organization_id', 'slug']
          },
          {
            foreignKeyName: 'work_tasks_pushed_by_fkey'
            columns: ['pushed_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_tasks_pushed_by_fkey'
            columns: ['pushed_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_tasks_pushed_by_fkey'
            columns: ['pushed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_tasks_pushed_by_fkey'
            columns: ['pushed_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_tasks_supervisor_assigned_by_fkey'
            columns: ['supervisor_assigned_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_tasks_supervisor_assigned_by_fkey'
            columns: ['supervisor_assigned_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'work_tasks_supervisor_assigned_by_fkey'
            columns: ['supervisor_assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_tasks_supervisor_assigned_by_fkey'
            columns: ['supervisor_assigned_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      work_type_settings: {
        Row: {
          abandonment_minutes: number
          batch_push_enabled: boolean
          bypass_priorities: string[]
          bypass_subtypes: string[]
          capacity_per_worker: number
          created_at: string
          default_priority: string
          enabled: boolean
          heartbeat_release_minutes: number
          notes: string | null
          organization_id: string
          payload_schema_version: number
          pull_enabled: boolean
          push_enabled: boolean
          require_capability: boolean
          require_zone_assignment: boolean
          reservation_escalation_minutes: number
          task_type: string
          updated_at: string
        }
        Insert: {
          abandonment_minutes?: number
          batch_push_enabled?: boolean
          bypass_priorities?: string[]
          bypass_subtypes?: string[]
          capacity_per_worker?: number
          created_at?: string
          default_priority?: string
          enabled?: boolean
          heartbeat_release_minutes?: number
          notes?: string | null
          organization_id: string
          payload_schema_version?: number
          pull_enabled?: boolean
          push_enabled?: boolean
          require_capability?: boolean
          require_zone_assignment?: boolean
          reservation_escalation_minutes?: number
          task_type: string
          updated_at?: string
        }
        Update: {
          abandonment_minutes?: number
          batch_push_enabled?: boolean
          bypass_priorities?: string[]
          bypass_subtypes?: string[]
          capacity_per_worker?: number
          created_at?: string
          default_priority?: string
          enabled?: boolean
          heartbeat_release_minutes?: number
          notes?: string | null
          organization_id?: string
          payload_schema_version?: number
          pull_enabled?: boolean
          push_enabled?: boolean
          require_capability?: boolean
          require_zone_assignment?: boolean
          reservation_escalation_minutes?: number
          task_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'work_type_settings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_type_settings_organization_id_task_type_fkey'
            columns: ['organization_id', 'task_type']
            isOneToOne: true
            referencedRelation: 'task_types'
            referencedColumns: ['organization_id', 'slug']
          },
        ]
      }
      work_type_warehouse_overrides: {
        Row: {
          capacity_per_worker: number | null
          created_at: string
          default_priority: string | null
          enabled: boolean | null
          notes: string | null
          organization_id: string
          task_type: string
          updated_at: string
          warehouse: string
        }
        Insert: {
          capacity_per_worker?: number | null
          created_at?: string
          default_priority?: string | null
          enabled?: boolean | null
          notes?: string | null
          organization_id: string
          task_type: string
          updated_at?: string
          warehouse: string
        }
        Update: {
          capacity_per_worker?: number | null
          created_at?: string
          default_priority?: string | null
          enabled?: boolean | null
          notes?: string | null
          organization_id?: string
          task_type?: string
          updated_at?: string
          warehouse?: string
        }
        Relationships: [
          {
            foreignKeyName: 'work_type_warehouse_overrides_organization_id_task_type_fkey'
            columns: ['organization_id', 'task_type']
            isOneToOne: false
            referencedRelation: 'work_type_settings'
            referencedColumns: ['organization_id', 'task_type']
          },
        ]
      }
      work_workflow_configs: {
        Row: {
          created_at: string | null
          description: string | null
          display_name: string
          id: string
          is_active: boolean | null
          organization_id: string
          steps: Json
          task_subtype: string
          updated_at: string | null
          updated_by: string | null
          version: number
          work_kind: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean | null
          organization_id: string
          steps?: Json
          task_subtype: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number
          work_kind?: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean | null
          organization_id?: string
          steps?: Json
          task_subtype?: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number
          work_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_workflow_configs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      worker_heartbeats: {
        Row: {
          created_at: string | null
          current_location: string | null
          current_task_id: string | null
          current_task_type: string | null
          current_zone: string | null
          device_info: Json | null
          last_heartbeat: string
          organization_id: string
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_location?: string | null
          current_task_id?: string | null
          current_task_type?: string | null
          current_zone?: string | null
          device_info?: Json | null
          last_heartbeat?: string
          organization_id: string
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_location?: string | null
          current_task_id?: string | null
          current_task_type?: string | null
          current_zone?: string | null
          device_info?: Json | null
          last_heartbeat?: string
          organization_id?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'worker_heartbeats_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'worker_heartbeats_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'worker_heartbeats_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'worker_heartbeats_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'worker_heartbeats_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'worker_performance_metrics_worker_id_fkey'
            columns: ['worker_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'worker_performance_metrics_worker_id_fkey'
            columns: ['worker_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'worker_performance_metrics_worker_id_fkey'
            columns: ['worker_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'worker_profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'worker_profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'worker_profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'working_areas_backup_supervisor_id_fkey'
            columns: ['backup_supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'working_areas_backup_supervisor_id_fkey'
            columns: ['backup_supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'working_areas_backup_supervisor_id_fkey'
            columns: ['backup_supervisor_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'working_areas_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'working_areas_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'working_areas_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'working_areas_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'working_areas_primary_supervisor_id_fkey'
            columns: ['primary_supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'working_areas_primary_supervisor_id_fkey'
            columns: ['primary_supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'working_areas_primary_supervisor_id_fkey'
            columns: ['primary_supervisor_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
    }
    Views: {
      cycle_count_workflow_configs: {
        Row: {
          count_type: string | null
          created_at: string | null
          description: string | null
          display_name: string | null
          id: string | null
          is_active: boolean | null
          organization_id: string | null
          steps: Json | null
          task_subtype: string | null
          updated_at: string | null
          updated_by: string | null
          version: number | null
          work_kind: string | null
        }
        Insert: {
          count_type?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          id?: string | null
          is_active?: boolean | null
          organization_id?: string | null
          steps?: Json | null
          task_subtype?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
          work_kind?: string | null
        }
        Update: {
          count_type?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          id?: string | null
          is_active?: boolean | null
          organization_id?: string | null
          steps?: Json | null
          task_subtype?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
          work_kind?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_workflow_configs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      omnibelt_tool_events_24h_mv: {
        Row: {
          bucket_hour: string | null
          event_count: number | null
          event_type: string | null
          organization_id: string | null
          tool_id: string | null
          user_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'omnibelt_tool_events_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      permissions_with_metadata: {
        Row: {
          action: string | null
          category_display_name: string | null
          category_icon: string | null
          category_name: string | null
          category_order: number | null
          conflicts_count: number | null
          description: string | null
          id: string | null
          is_critical: boolean | null
          metadata: Json | null
          name: string | null
          optional_dependencies_count: number | null
          required_dependencies_count: number | null
          requires_2fa: boolean | null
          resource: string | null
          risk_level: string | null
          scope: string | null
          tags: string[] | null
        }
        Relationships: []
      }
      role_hierarchy: {
        Row: {
          depth: number | null
          display_name: string | null
          id: string | null
          level: number | null
          name: string | null
          name_path: string[] | null
          parent_role_id: string | null
          path: string[] | null
          priority: number | null
        }
        Relationships: []
      }
      role_permission_summary: {
        Row: {
          active_user_count: number | null
          description: string | null
          display_name: string | null
          hierarchy_level: number | null
          is_active: boolean | null
          is_system: boolean | null
          parent_role_id: string | null
          parent_role_name: string | null
          permissions: string[] | null
          priority: number | null
          role_id: string | null
          role_name: string | null
          summarized_at: string | null
          total_permissions: number | null
          total_user_count: number | null
          unique_resources: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'roles_parent_role_id_fkey'
            columns: ['parent_role_id']
            isOneToOne: false
            referencedRelation: 'role_permission_summary'
            referencedColumns: ['role_id']
          },
          {
            foreignKeyName: 'roles_parent_role_id_fkey'
            columns: ['parent_role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      tab_permission_aggregate: {
        Row: {
          aggregated_at: string | null
          email: string | null
          granted_tabs: number | null
          page_resource: string | null
          role_name: string | null
          tab_permissions: Json[] | null
          total_tabs: number | null
          user_id: string | null
        }
        Relationships: []
      }
      tab_permissions: {
        Row: {
          app_id: string | null
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string | null
          is_active: boolean | null
          page_resource: string | null
          required_permissions: Json | null
          tab_id: string | null
          tab_label: string | null
          tab_name: string | null
          visible_by_default: boolean | null
        }
        Insert: {
          app_id?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string | null
          is_active?: boolean | null
          page_resource?: string | null
          required_permissions?: never
          tab_id?: string | null
          tab_label?: string | null
          tab_name?: string | null
          visible_by_default?: never
        }
        Update: {
          app_id?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string | null
          is_active?: boolean | null
          page_resource?: string | null
          required_permissions?: never
          tab_id?: string | null
          tab_label?: string | null
          tab_name?: string | null
          visible_by_default?: never
        }
        Relationships: []
      }
      user_permission_aggregate: {
        Row: {
          aggregated_at: string | null
          all_permissions: string[] | null
          direct_permission_count: number | null
          direct_permissions: string[] | null
          email: string | null
          last_seen: string | null
          role_display_name: string | null
          role_id: string | null
          role_name: string | null
          role_permission_count: number | null
          role_permissions: string[] | null
          user_created_at: string | null
          user_id: string | null
          user_status: Database['public']['Enums']['user_status'] | null
        }
        Relationships: [
          {
            foreignKeyName: 'user_profiles_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'role_permission_summary'
            referencedColumns: ['role_id']
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
      v_active_board_jobs: {
        Row: {
          apply_email: string | null
          apply_url: string | null
          attachments: Json | null
          branch_id: string | null
          closes_at: string | null
          color_hex: string | null
          created_at: string | null
          department: string | null
          description: string | null
          id: string | null
          is_internal: boolean | null
          is_published: boolean | null
          kind_data: Json | null
          organization_id: string | null
          posted_at: string | null
          posted_by: string | null
          priority: string | null
          requirements: string | null
          title: string | null
          updated_at: string | null
          working_area_id: string | null
        }
        Insert: {
          apply_email?: string | null
          apply_url?: string | null
          attachments?: Json | null
          branch_id?: string | null
          closes_at?: string | null
          color_hex?: string | null
          created_at?: string | null
          department?: string | null
          description?: string | null
          id?: string | null
          is_internal?: boolean | null
          is_published?: boolean | null
          kind_data?: Json | null
          organization_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          priority?: string | null
          requirements?: string | null
          title?: string | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Update: {
          apply_email?: string | null
          apply_url?: string | null
          attachments?: Json | null
          branch_id?: string | null
          closes_at?: string | null
          color_hex?: string | null
          created_at?: string | null
          department?: string | null
          description?: string | null
          id?: string | null
          is_internal?: boolean | null
          is_published?: boolean | null
          kind_data?: Json | null
          organization_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          priority?: string | null
          requirements?: string | null
          title?: string | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'production_board_job_postings_branch_id_fkey'
            columns: ['branch_id']
            isOneToOne: false
            referencedRelation: 'branches'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_job_postings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_job_postings_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_job_postings_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_job_postings_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_job_postings_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_job_postings_working_area_id_fkey'
            columns: ['working_area_id']
            isOneToOne: false
            referencedRelation: 'working_areas'
            referencedColumns: ['id']
          },
        ]
      }
      v_active_board_posts: {
        Row: {
          acknowledged_required: boolean | null
          attachments: Json | null
          body: string | null
          branch_id: string | null
          color_hex: string | null
          created_at: string | null
          expires_at: string | null
          id: string | null
          image_url: string | null
          is_pinned: boolean | null
          is_published: boolean | null
          kind_data: Json | null
          organization_id: string | null
          posted_by: string | null
          priority: string | null
          published_at: string | null
          reprompt_interval_minutes: number | null
          scope: Database['public']['Enums']['post_scope'] | null
          severity: Database['public']['Enums']['post_severity'] | null
          title: string | null
          updated_at: string | null
          working_area_id: string | null
        }
        Insert: {
          acknowledged_required?: boolean | null
          attachments?: Json | null
          body?: string | null
          branch_id?: string | null
          color_hex?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          image_url?: string | null
          is_pinned?: boolean | null
          is_published?: boolean | null
          kind_data?: Json | null
          organization_id?: string | null
          posted_by?: string | null
          priority?: string | null
          published_at?: string | null
          reprompt_interval_minutes?: number | null
          scope?: Database['public']['Enums']['post_scope'] | null
          severity?: Database['public']['Enums']['post_severity'] | null
          title?: string | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Update: {
          acknowledged_required?: boolean | null
          attachments?: Json | null
          body?: string | null
          branch_id?: string | null
          color_hex?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          image_url?: string | null
          is_pinned?: boolean | null
          is_published?: boolean | null
          kind_data?: Json | null
          organization_id?: string | null
          posted_by?: string | null
          priority?: string | null
          published_at?: string | null
          reprompt_interval_minutes?: number | null
          scope?: Database['public']['Enums']['post_scope'] | null
          severity?: Database['public']['Enums']['post_severity'] | null
          title?: string | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'production_board_posts_branch_id_fkey'
            columns: ['branch_id']
            isOneToOne: false
            referencedRelation: 'branches'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_posts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_posts_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_posts_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_posts_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'production_board_posts_posted_by_fkey'
            columns: ['posted_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'production_board_posts_working_area_id_fkey'
            columns: ['working_area_id']
            isOneToOne: false
            referencedRelation: 'working_areas'
            referencedColumns: ['id']
          },
        ]
      }
      v_cycle_count_active_zones: {
        Row: {
          acquired_at: string | null
          active_count_count: number | null
          active_count_ids: string[] | null
          active_ids: string[] | null
          actively_counting: number | null
          earliest_reservation_at: string | null
          has_active: boolean | null
          has_reservation: boolean | null
          is_stuck: boolean | null
          locked_by: string | null
          locked_by_email: string | null
          locked_by_name: string | null
          minutes_since_seen: number | null
          organization_id: string | null
          owner_last_heartbeat: string | null
          owner_online: boolean | null
          reserved_count: number | null
          reserved_ids: string[] | null
          zone: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_cyclecount_data_assigned_to_fkey'
            columns: ['locked_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_assigned_to_fkey'
            columns: ['locked_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_assigned_to_fkey'
            columns: ['locked_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_assigned_to_fkey'
            columns: ['locked_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
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
      v_cycle_count_defer_history: {
        Row: {
          cleared_at: string | null
          count_id: string | null
          count_number: string | null
          created_at: string | null
          defer_reason: string | null
          deferred_at: string | null
          id: string | null
          is_active: boolean | null
          organization_id: string | null
          reactivated_at: string | null
          resume_priority: number | null
          times_deferred: number | null
          updated_at: string | null
          user_email: string | null
          user_full_name: string | null
          user_id: string | null
          user_username: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_count_id_fkey'
            columns: ['count_id']
            isOneToOne: false
            referencedRelation: 'rr_cyclecount_data'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_operator_deferred_counts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      v_cycle_count_zone_assignments: {
        Row: {
          created_at: string | null
          notes: string | null
          organization_id: string | null
          updated_at: string | null
          user_email: string | null
          user_id: string | null
          user_name: string | null
          zone: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_zone_assignments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      v_latest_inbound_part_transfers: {
        Row: {
          accepted_at: string | null
          accepted_by_associate_id: string | null
          area_barcode: string | null
          area_name: string | null
          associate_badge_code: string | null
          associate_email: string | null
          associate_name: string | null
          associate_user_id: string | null
          drop_off_area_id: string | null
          dropped_off_at: string | null
          dropped_off_by: string | null
          dropped_off_by_email: string | null
          dropped_off_by_name: string | null
          notes: string | null
          organization_id: string | null
          tka_batch_number: string | null
          transfer_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_drop_off_area_associates_user_id_fkey'
            columns: ['associate_user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_drop_off_area_associates_user_id_fkey'
            columns: ['associate_user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_drop_off_area_associates_user_id_fkey'
            columns: ['associate_user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_drop_off_area_associates_user_id_fkey'
            columns: ['associate_user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_accepted_by_associate_id_fkey'
            columns: ['accepted_by_associate_id']
            isOneToOne: false
            referencedRelation: 'rr_drop_off_area_associates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_drop_off_area_id_fkey'
            columns: ['drop_off_area_id']
            isOneToOne: false
            referencedRelation: 'rr_drop_off_areas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_dropped_off_by_fkey'
            columns: ['dropped_off_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_dropped_off_by_fkey'
            columns: ['dropped_off_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_dropped_off_by_fkey'
            columns: ['dropped_off_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_dropped_off_by_fkey'
            columns: ['dropped_off_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'rr_inbound_part_transfers_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      work_engine_dispatch_fairness: {
        Row: {
          claims_60m: number | null
          organization_id: string | null
          priority: string | null
          task_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'work_events_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      work_engine_drift: {
        Row: {
          assignee_drift: number | null
          calculated_at: string | null
          missing_in_shadow: number | null
          organization_id: string | null
          priority_drift: number | null
          status_drift: number | null
          task_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_cyclecount_data_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      work_engine_health: {
        Row: {
          oldest_in_progress_age_s: number | null
          oldest_pending_age_s: number | null
          oldest_reservation_age_s: number | null
          open_count: number | null
          organization_id: string | null
          priority: string | null
          status: string | null
          task_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'work_tasks_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_tasks_organization_id_task_type_fkey'
            columns: ['organization_id', 'task_type']
            isOneToOne: false
            referencedRelation: 'task_types'
            referencedColumns: ['organization_id', 'slug']
          },
        ]
      }
      work_zone_assignments: {
        Row: {
          created_at: string | null
          created_by: string | null
          notes: string | null
          organization_id: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
          zone: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          notes?: string | null
          organization_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
          zone?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          notes?: string | null
          organization_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_zone_assignments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      work_zone_rules: {
        Row: {
          bypass_count_types: string[] | null
          bypass_priorities: string[] | null
          created_at: string | null
          created_by: string | null
          enabled: boolean | null
          exclusion_pairs: Json | null
          notes: string | null
          organization_id: string | null
          policy: string | null
          sticky_zone: boolean | null
          supervisor_assignment_protection_hours: number | null
          treat_null_zone_as_locked: boolean | null
          updated_at: string | null
          updated_by: string | null
          zone_pattern: string | null
        }
        Insert: {
          bypass_count_types?: string[] | null
          bypass_priorities?: string[] | null
          created_at?: string | null
          created_by?: string | null
          enabled?: boolean | null
          exclusion_pairs?: Json | null
          notes?: string | null
          organization_id?: string | null
          policy?: string | null
          sticky_zone?: boolean | null
          supervisor_assignment_protection_hours?: number | null
          treat_null_zone_as_locked?: boolean | null
          updated_at?: string | null
          updated_by?: string | null
          zone_pattern?: string | null
        }
        Update: {
          bypass_count_types?: string[] | null
          bypass_priorities?: string[] | null
          created_at?: string | null
          created_by?: string | null
          enabled?: boolean | null
          exclusion_pairs?: Json | null
          notes?: string | null
          organization_id?: string | null
          policy?: string | null
          sticky_zone?: boolean | null
          supervisor_assignment_protection_hours?: number | null
          treat_null_zone_as_locked?: boolean | null
          updated_at?: string | null
          updated_by?: string | null
          zone_pattern?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cycle_count_zone_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'tab_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_permission_aggregate'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cycle_count_zone_rules_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'worker_capabilities'
            referencedColumns: ['user_id']
          },
        ]
      }
      worker_capabilities: {
        Row: {
          blocked_work_types: string[] | null
          organization_id: string | null
          user_id: string | null
          work_types: string[] | null
          zones: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: 'user_profiles_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Functions: {
      acknowledge_pushed_count: {
        Args: { p_count_id: string; p_user_id: string }
        Returns: Json
      }
      admin_release_abandoned_count: {
        Args: { p_count_id: string; p_reason?: string }
        Returns: Json
      }
      apply_auto_map_run: { Args: { p_run_id: string }; Returns: Json }
      apply_cycle_count_priority_rules: {
        Args: { p_org_id?: string }
        Returns: Json
      }
      array_append_evidence_photo: {
        Args: { p_task_id: string; p_url: string }
        Returns: Json
      }
      assign_cycle_count_to_user: {
        Args: { count_id: string; user_id: string }
        Returns: Json
      }
      assign_cycle_count_to_user_force: {
        Args: { p_count_id: string; p_user_id: string }
        Returns: Json
      }
      assign_next_cycle_count: { Args: { p_user_id: string }; Returns: Json }
      assign_tab_permissions_to_role: {
        Args: { p_role_id: string; p_tab_definition_ids: string[] }
        Returns: undefined
      }
      auto_cleanup_abandoned_counts: { Args: never; Returns: Json }
      auto_connect_aisle_nodes: {
        Args: { p_k?: number; p_map_id: string }
        Returns: number
      }
      backfill_mapping_nearest_node: {
        Args: { p_map_id: string }
        Returns: number
      }
      backfill_pending_putaway_confirms: {
        Args: {
          p_failed_min_age_seconds?: number
          p_lookback_hours?: number
          p_max_claim_count?: number
          p_organization_id?: string
        }
        Returns: {
          oldest_pending_minutes: number
          rows_failed_requeued: number
          rows_orphan_replayed: number
        }[]
      }
      bulk_assign_locations: {
        Args: {
          p_assignments: Json
          p_organization_id: string
          p_rack_id: string
        }
        Returns: number
      }
      bulk_assign_permissions: {
        Args: {
          p_expires_at?: string
          p_granted?: boolean
          p_permission_ids: string[]
          p_reason?: string
          p_target_id: string
          p_target_type: string
        }
        Returns: {
          error_count: number
          errors: Json
          success_count: number
        }[]
      }
      bulk_assign_tasks: {
        Args: { p_assignment_strategy?: string; p_task_ids: string[] }
        Returns: Json
      }
      bump_sap_agent_job_lease: {
        Args: { p_agent_id: string; p_job_id: string; p_lease_seconds?: number }
        Returns: string
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
      cancel_auto_map_run: { Args: { p_run_id: string }; Returns: Json }
      categorize_storage_area: {
        Args: { storage_bin: string }
        Returns: string
      }
      check_circular_reporting_chain: {
        Args: { p_position_id: string; p_reports_to_id: string }
        Returns: boolean
      }
      check_conditional_permission: {
        Args: { p_action: string; p_resource: string; p_user_id: string }
        Returns: boolean
      }
      check_hot_part_alerts: {
        Args: {
          p_material_number?: string
          p_organization_id?: string
          p_so_line_rma_afa?: string
          p_tracking_number?: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          match_type: string
          match_value: string
          notes: string | null
          organization_id: string
          priority: string
          updated_at: string
        }[]
        SetofOptions: {
          from: '*'
          to: 'rr_hot_part_alerts'
          isOneToOne: false
          isSetofReturn: true
        }
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
      claim_sap_agent_job: {
        Args: {
          p_agent_id: string
          p_lease_seconds?: number
          p_organization_id: string
        }
        Returns: {
          assigned_agent_id: string | null
          attempts: number
          claim_count: number
          claim_lease_until: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          endpoint: string
          error: string | null
          heartbeat_at: string | null
          id: string
          idempotency_key: string | null
          max_attempts: number
          organization_id: string
          payload: Json
          priority: number
          requested_by: string | null
          result: Json | null
          started_at: string | null
          status: string
          step: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'sap_agent_jobs'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cleanup_expired_customer_portal_cache: { Args: never; Returns: number }
      cleanup_expired_sessions: { Args: never; Returns: number }
      cleanup_expired_temporary_assignments: { Args: never; Returns: number }
      cleanup_smartsheet_expired_cache: { Args: never; Returns: number }
      clear_deferred_count: {
        Args: { p_count_id: string; p_user_id: string }
        Returns: undefined
      }
      complete_putaway_and_clear_cart: {
        Args: {
          p_material_number: string
          p_putaway_data: Json
          p_raw_to_number: string
        }
        Returns: Json
      }
      complete_task_with_supervisor_pin: {
        Args: {
          p_notes: string
          p_pin: string
          p_result_payload: Json
          p_supervisor_user_id: string
          p_task_id: string
        }
        Returns: Json
      }
      compute_next_run_at: {
        Args: { p_expr: string; p_from?: string }
        Returns: string
      }
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
      cycle_count_thresholds_from_config: {
        Args: { p_config_id: string }
        Returns: Record<string, unknown>
      }
      cycle_count_zone_of: {
        Args: { p_location: string; p_pattern?: string }
        Returns: string
      }
      detect_abandoned_cycle_counts: {
        Args: { p_abandonment_threshold_minutes?: number }
        Returns: Json
      }
      enqueue_due_schedules: { Args: never; Returns: number }
      ensure_warehouse_map_settings: {
        Args: never
        Returns: {
          allow_layout_edits: boolean
          allow_status_changes: boolean
          default_warehouse_code: string | null
          enabled: boolean
          fallback_mode: Database['public']['Enums']['warehouse_fallback_mode']
          id: string
          live_updates_enabled: boolean
          organization_id: string
          read_only_mode: boolean
          show_3d_viewer: boolean
          stale_after_minutes: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'warehouse_map_settings'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      escalate_stale_zone_reservations: {
        Args: { p_organization_id?: string; p_threshold_minutes?: number }
        Returns: {
          out_count_id: string
          out_count_number: string
          out_previous_owner: string
        }[]
      }
      escalate_stalled_tasks: { Args: never; Returns: Json }
      escalate_ticket_auto: { Args: { p_ticket_id: string }; Returns: boolean }
      execute_auto_map_run: { Args: { p_run_id: string }; Returns: Json }
      expire_stale_commands: { Args: never; Returns: number }
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
      find_nearest_node: {
        Args: {
          p_floor_level?: number
          p_map_id: string
          p_x: number
          p_y: number
        }
        Returns: string
      }
      generate_badge_number: {
        Args: { p_organization_id: string }
        Returns: string
      }
      generate_count_number: {
        Args: { p_organization_id?: string }
        Returns: string
      }
      generate_count_numbers: {
        Args: { p_count?: number; p_organization_id: string }
        Returns: string[]
      }
      generate_table_ddl: { Args: { p_table: string }; Returns: string }
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
      get_active_workers: {
        Args: { p_org_id: string; p_stale_threshold_minutes?: number }
        Returns: Json
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
      get_api_key_stats: {
        Args: { p_hours?: number; p_service_name: string }
        Returns: {
          avg_response_time_ms: number
          error_count: number
          success_rate: number
          total_requests: number
        }[]
      }
      get_available_activity_tables: {
        Args: never
        Returns: {
          columns: Json
          table_name: string
        }[]
      }
      get_count_type_display_name: {
        Args: { type_value: string }
        Returns: string
      }
      get_customer_portal_access: { Args: { p_user_id: string }; Returns: Json }
      get_customer_portal_metrics: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          attachments_added: number
          avg_response_time_ms: number
          comments_made: number
          field_updates: number
          status_changes: number
          tickets_created: number
          tickets_handled: number
          total_actions: number
          user_email: string
          user_first_name: string
          user_full_name: string
          user_id: string
          user_last_name: string
        }[]
      }
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
      get_inbound_scan_report_stats: {
        Args: { days_back?: number }
        Returns: Json
      }
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
      get_map_revisions: {
        Args: { p_map_id: string }
        Returns: {
          change_summary: string
          created_at: string
          created_by: string
          id: string
          published_at: string
          rolled_back_from_revision_id: string
          status: string
          version_number: number
        }[]
      }
      get_material_master_statistics: { Args: never; Returns: Json }
      get_mdm_command_metrics: { Args: { p_days?: number }; Returns: Json }
      get_mdm_fleet_statistics: { Args: never; Returns: Json }
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
      get_permission_with_dependencies: {
        Args: { permission_id: string }
        Returns: {
          dependency_action: string
          dependency_id: string
          dependency_name: string
          dependency_resource: string
          dependency_type: string
          is_optional: boolean
          perm_action: string
          perm_id: string
          perm_name: string
          perm_resource: string
        }[]
      }
      get_pick_tour: {
        Args: { p_bins: string[]; p_from_bin: string; p_map_id: string }
        Returns: Json
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
      get_role_children: {
        Args: { target_role_id: string }
        Returns: {
          child_role_id: string
          child_role_name: string
          level: number
        }[]
      }
      get_route: {
        Args: { p_from_bin: string; p_map_id: string; p_to_bin: string }
        Returns: Json
      }
      get_scheduled_tasks_for_date: {
        Args: {
          p_date?: string
          p_organization_id: string
          p_user_id: string
          p_working_area_id?: string
        }
        Returns: Json
      }
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
          area: string
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
          cart_stows: number
          customer_responses: number
          cycle_counts: number
          final_packed: number
          inbound_scans: number
          kit_building: number
          kit_dock_staging: number
          kit_inspection: number
          kit_picking: number
          packed: number
          picking: number
          put_aways: number
          putbacks: number
          shipped: number
          total_tasks: number
          user_id: string
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
      get_unassigned_bins: {
        Args: {
          p_area?: string
          p_limit?: number
          p_map_id: string
          p_search?: string
        }
        Returns: {
          material: string
          storage_area: string
          storage_bin: string
          total_stock: number
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
      get_user_daily_completion: {
        Args: { p_days?: number; p_organization_id: string }
        Returns: Json
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
      get_user_pushed_counts: { Args: { p_user_id: string }; Returns: Json }
      get_user_role:
        | { Args: never; Returns: Database['public']['Enums']['user_role'] }
        | { Args: { user_uuid: string }; Returns: string }
      get_user_session_config: {
        Args: { p_user_id: string }
        Returns: {
          auto_logout_timeout_minutes: number
          enable_fullscreen_expiry_warning: boolean
          remember_me_duration_hours: number
          session_timeout_minutes: number
          warning_time_minutes: number
        }[]
      }
      get_user_standard_work_stats: {
        Args: { p_days?: number; p_organization_id: string; p_user_id: string }
        Returns: Json
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
      get_warehouse_map_diagnostics: {
        Args: { p_map_id: string }
        Returns: Json
      }
      get_warehouse_map_layout: { Args: { p_map_id: string }; Returns: Json }
      get_warehouse_map_statistics: {
        Args: { p_map_id: string }
        Returns: Json
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
      get_windowed_location_details: {
        Args: {
          p_limit?: number
          p_map_id: string
          p_mapping_ids?: string[]
          p_max_x?: number
          p_max_y?: number
          p_min_x?: number
          p_min_y?: number
        }
        Returns: {
          available_stock: number
          freshness_state: string
          last_lx03_seen_at: string
          mapping_id: string
          material_summary: string
          mlgt_height: number
          mlgt_length: number
          mlgt_match_status: string
          mlgt_max_quantity: number
          mlgt_width: number
          occupancy_state: string
          operational_status: string
          rack_column: number
          rack_id: string
          rack_row: number
          storage_bin: string
          total_stock: number
        }[]
      }
      get_workers_by_zone: {
        Args: { p_org_id: string; p_zone?: string }
        Returns: Json
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
      ingest_asset_position: {
        Args: {
          p_asset_id: string
          p_floor_level?: number
          p_heading_deg?: number
          p_metadata?: Json
          p_observed_at?: string
          p_source?: string
          p_speed_mps?: number
          p_x: number
          p_y: number
        }
        Returns: {
          asset_id: string
          floor_level: number
          heading_deg: number | null
          map_id: string
          metadata: Json | null
          observed_at: string
          organization_id: string
          source: string | null
          speed_mps: number | null
          x: number
          y: number
        }
        SetofOptions: {
          from: '*'
          to: 'warehouse_asset_position_latest'
          isOneToOne: true
          isSetofReturn: false
        }
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
      is_valid_user_role_enum: { Args: { role_name: string }; Returns: boolean }
      log_api_key_usage: {
        Args: {
          p_endpoint: string
          p_ip_address?: unknown
          p_response_status?: number
          p_response_time_ms?: number
          p_service_name: string
          p_user_agent?: string
        }
        Returns: string
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
      mark_audit_row_reversed: {
        Args: { p_original_id: string; p_reversal_id: string }
        Returns: boolean
      }
      mark_stale_sap_agents_offline: { Args: never; Returns: number }
      priority_int_to_text: { Args: { p: number }; Returns: string }
      priority_text_to_int: { Args: { p: string }; Returns: number }
      prune_asset_positions: {
        Args: { p_keep_minutes?: number }
        Returns: number
      }
      publish_map_revision: {
        Args: {
          p_expected_revision?: number
          p_map_id: string
          p_summary: string
        }
        Returns: Json
      }
      purge_old_offline_sap_agents: {
        Args: { p_max_age_days?: number }
        Returns: number
      }
      push_cycle_count_to_user: {
        Args: { p_count_id: string; p_pushed_by: string; p_user_id: string }
        Returns: Json
      }
      reap_stale_sap_agents: {
        Args: { p_grace_seconds?: number }
        Returns: number
      }
      reassign_associate_to_area: {
        Args: {
          p_expected_updated_at?: string
          p_new_area_id?: string
          p_organization_id: string
          p_reason?: string
          p_reassigned_by?: string
          p_user_id: string
        }
        Returns: Json
      }
      reassign_work_zone: {
        Args: {
          p_from: string
          p_idempotency_key: string
          p_mode: string
          p_org: string
          p_to: string
          p_zone: string
        }
        Returns: Json
      }
      rebalance_work_queue: { Args: never; Returns: Json }
      recompute_device_health_scores: { Args: never; Returns: number }
      record_article_view: {
        Args: { p_article_id: string; p_user_id?: string }
        Returns: boolean
      }
      record_settings_change_event: {
        Args: {
          p_after: Json
          p_before: Json
          p_key: string
          p_org: string
          p_table: string
        }
        Returns: string
      }
      refresh_rbac_materialized_views: {
        Args: never
        Returns: {
          duration_ms: number
          refresh_status: string
          view_name: string
        }[]
      }
      release_abandoned_cycle_counts: {
        Args: {
          p_abandonment_threshold_minutes?: number
          p_max_releases?: number
        }
        Returns: Json
      }
      release_all_stuck_cycle_count_assignments: {
        Args: { p_also_unassign?: boolean; p_threshold_minutes?: number }
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
      release_stale_heartbeat_assignments: {
        Args: { p_organization_id?: string; p_threshold_minutes?: number }
        Returns: {
          out_count_id: string
          out_count_number: string
          out_previous_owner: string
        }[]
      }
      release_stuck_cycle_count_assignment: {
        Args: { p_also_unassign?: boolean; p_count_id: string }
        Returns: Json
      }
      resolve_cycle_count_location: {
        Args: { p_org_id: string; p_raw_location: string; p_warehouse: string }
        Returns: {
          mapping_id: string
          resolved_aisle: string
          resolved_key: string
          resolved_seq: number
          resolved_zone: string
          source: string
        }[]
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
      rollback_map_revision: {
        Args: { p_map_id: string; p_revision_id: string }
        Returns: Json
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
      search_mdm_devices: {
        Args: {
          p_group_id?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: {
          device: Json
          total_count: number
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
      seed_aisle_nodes_from_racks: {
        Args: { p_map_id: string }
        Returns: number
      }
      seed_area_and_department_options: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      seed_kitting_dropdown_options: {
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
      set_supervisor_pin: { Args: { p_pin: string }; Returns: undefined }
      skip_cycle_count_for_operator: {
        Args: { p_count_id: string; p_reason?: string; p_user_id: string }
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
      update_location_operational_status: {
        Args: {
          p_changed_by: string
          p_expected_updated_at: string
          p_mapping_id: string
          p_new_status: Database['public']['Enums']['warehouse_operational_status']
          p_reason: string
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
      upsert_worker_heartbeat: {
        Args: {
          p_current_location?: string
          p_current_task_id?: string
          p_current_task_type?: string
          p_current_zone?: string
          p_device_info?: Json
          p_organization_id: string
          p_status?: string
          p_user_id: string
        }
        Returns: Json
      }
      user_can_see_navigation_item:
        | {
            Args: { navigation_item_id: string; user_id: string }
            Returns: boolean
          }
        | { Args: { item_id: number; user_uuid: string }; Returns: boolean }
      validate_invitation_token: { Args: { p_token: string }; Returns: Json }
      validate_organization_access: {
        Args: { org_id: string }
        Returns: boolean
      }
      validate_permission_assignment: {
        Args: { permission_id: string; user_id: string }
        Returns: {
          conflicting_permissions: string[]
          is_valid: boolean
          missing_dependencies: string[]
        }[]
      }
      validate_service_api_key: {
        Args: { p_key_hash: string; p_key_prefix: string }
        Returns: {
          is_valid: boolean
          permissions: Json
          rate_limit: number
          service_name: string
        }[]
      }
      verify_supervisor_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: boolean
      }
      work_engine_feature_flag: {
        Args: { p_key: string; p_org: string }
        Returns: boolean
      }
      work_engine_is_manager_or_above_in_org: {
        Args: { p_org: string }
        Returns: boolean
      }
      work_setting: {
        Args: {
          p_key: string
          p_org: string
          p_task_type: string
          p_warehouse: string
        }
        Returns: Json
      }
      work_zone_of: {
        Args: { p_location: string; p_pattern: string }
        Returns: string
      }
    }
    Enums: {
      app_status: 'active' | 'inactive' | 'maintenance' | 'deprecated'
      article_status: 'draft' | 'published' | 'archived' | 'under_review'
      article_visibility: 'public' | 'customers_only' | 'internal_only'
      audit_action:
        | 'create'
        | 'update'
        | 'delete'
        | 'view'
        | 'login'
        | 'logout'
        | 'complete'
        | 'assign'
        | 'cleanup'
      clock_entry_method: 'badge' | 'manual' | 'supervisor_entry'
      clock_entry_status: 'active' | 'completed' | 'missed_punch' | 'void'
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
        | 'awaiting_supervisor_signoff'
      message_channel:
        | 'email'
        | 'chat'
        | 'internal_note'
        | 'sms'
        | 'phone'
        | 'system'
      metric_trend_period:
        | 'rolling_4_weeks'
        | 'rolling_30_days'
        | 'last_6_months'
        | 'ytd'
        | 'custom'
      metric_value_format:
        | 'number'
        | 'percent'
        | 'currency'
        | 'duration'
        | 'text'
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
      path_direction: 'ascending' | 'descending'
      path_fallback_behavior:
        | 'allow_unmapped_last'
        | 'block_unmapped'
        | 'ignore_path_rules'
      path_strategy: 'serpentine_zone' | 'directional' | 'alternating_aisles'
      portal_access_status: 'invited' | 'active' | 'suspended' | 'revoked'
      post_scope: 'announcement' | 'hr_news' | 'safety_alert'
      post_severity: 'info' | 'success' | 'warning' | 'danger'
      putback_status: 'open' | 'in_progress' | 'completed' | 'cancelled'
      review_status: 'draft' | 'in_progress' | 'completed' | 'acknowledged'
      review_type:
        | 'annual'
        | 'quarterly'
        | 'probationary'
        | 'improvement_plan'
        | 'self_assessment'
      sap_system_type: 'ECC' | 'S4HANA'
      sla_status: 'met' | 'at_risk' | 'breached' | 'paused' | 'exempt'
      sqcdp_problem_status: 'open' | 'in_progress' | 'resolved' | 'escalated'
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
      time_card_note_type:
        | 'general'
        | 'missed_punch'
        | 'correction'
        | 'approval'
        | 'rejection'
      time_card_status:
        | 'pending'
        | 'submitted'
        | 'approved'
        | 'rejected'
        | 'needs_revision'
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
      warehouse_aisle_node_kind:
        | 'aisle'
        | 'doorway'
        | 'pickup'
        | 'dock'
        | 'stair'
        | 'elevator'
        | 'manual'
      warehouse_asset_kind:
        | 'forklift'
        | 'operator'
        | 'cart'
        | 'pallet_jack'
        | 'robot'
        | 'sensor'
        | 'other'
      warehouse_auto_map_status:
        | 'queued'
        | 'running'
        | 'awaiting_review'
        | 'applied'
        | 'failed'
        | 'cancelled'
      warehouse_fallback_mode: 'placeholder' | 'list' | 'map'
      warehouse_operational_status:
        | 'active'
        | 'maintenance'
        | 'shutdown'
        | 'reserved'
        | 'blocked'
      warehouse_revision_status:
        | 'draft'
        | 'published'
        | 'archived'
        | 'rolled_back'
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
      audit_action: [
        'create',
        'update',
        'delete',
        'view',
        'login',
        'logout',
        'complete',
        'assign',
        'cleanup',
      ],
      clock_entry_method: ['badge', 'manual', 'supervisor_entry'],
      clock_entry_status: ['active', 'completed', 'missed_punch', 'void'],
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
        'awaiting_supervisor_signoff',
      ],
      message_channel: [
        'email',
        'chat',
        'internal_note',
        'sms',
        'phone',
        'system',
      ],
      metric_trend_period: [
        'rolling_4_weeks',
        'rolling_30_days',
        'last_6_months',
        'ytd',
        'custom',
      ],
      metric_value_format: [
        'number',
        'percent',
        'currency',
        'duration',
        'text',
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
      path_direction: ['ascending', 'descending'],
      path_fallback_behavior: [
        'allow_unmapped_last',
        'block_unmapped',
        'ignore_path_rules',
      ],
      path_strategy: ['serpentine_zone', 'directional', 'alternating_aisles'],
      portal_access_status: ['invited', 'active', 'suspended', 'revoked'],
      post_scope: ['announcement', 'hr_news', 'safety_alert'],
      post_severity: ['info', 'success', 'warning', 'danger'],
      putback_status: ['open', 'in_progress', 'completed', 'cancelled'],
      review_status: ['draft', 'in_progress', 'completed', 'acknowledged'],
      review_type: [
        'annual',
        'quarterly',
        'probationary',
        'improvement_plan',
        'self_assessment',
      ],
      sap_system_type: ['ECC', 'S4HANA'],
      sla_status: ['met', 'at_risk', 'breached', 'paused', 'exempt'],
      sqcdp_problem_status: ['open', 'in_progress', 'resolved', 'escalated'],
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
      time_card_note_type: [
        'general',
        'missed_punch',
        'correction',
        'approval',
        'rejection',
      ],
      time_card_status: [
        'pending',
        'submitted',
        'approved',
        'rejected',
        'needs_revision',
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
      warehouse_aisle_node_kind: [
        'aisle',
        'doorway',
        'pickup',
        'dock',
        'stair',
        'elevator',
        'manual',
      ],
      warehouse_asset_kind: [
        'forklift',
        'operator',
        'cart',
        'pallet_jack',
        'robot',
        'sensor',
        'other',
      ],
      warehouse_auto_map_status: [
        'queued',
        'running',
        'awaiting_review',
        'applied',
        'failed',
        'cancelled',
      ],
      warehouse_fallback_mode: ['placeholder', 'list', 'map'],
      warehouse_operational_status: [
        'active',
        'maintenance',
        'shutdown',
        'reserved',
        'blocked',
      ],
      warehouse_revision_status: [
        'draft',
        'published',
        'archived',
        'rolled_back',
      ],
    },
  },
} as const
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

// OmniBelt — added via migration 327 (2026-05-24)
export type OmnibeltRoleConfig =
  Database['public']['Tables']['omnibelt_role_config']['Row']
export type OmnibeltRoleConfigInsert =
  Database['public']['Tables']['omnibelt_role_config']['Insert']
export type OmnibeltRoleConfigUpdate =
  Database['public']['Tables']['omnibelt_role_config']['Update']
export type OmnibeltUserPrefs =
  Database['public']['Tables']['omnibelt_user_prefs']['Row']
export type OmnibeltUserPrefsInsert =
  Database['public']['Tables']['omnibelt_user_prefs']['Insert']
export type OmnibeltUserPrefsUpdate =
  Database['public']['Tables']['omnibelt_user_prefs']['Update']
export type OmnibeltToolEvent =
  Database['public']['Tables']['omnibelt_tool_events']['Row']
export type OmnibeltToolEventInsert =
  Database['public']['Tables']['omnibelt_tool_events']['Insert']

// Created and developed by Jai Singh
