// Created and developed by Jai Singh
/**
 * Supabase Edge Function: Analytics API Proxy
 * 
 * This Edge Function acts as a proxy to the FastAPI backend.
 * It forwards all requests to the FastAPI server and returns the responses.
 * 
 * Environment Variables Required:
 * - FASTAPI_BACKEND_URL: The URL of your deployed FastAPI backend
 *   (e.g., https://your-app.railway.app or http://localhost:8000 for local dev)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get the FastAPI backend URL from environment variables
    const FASTAPI_BACKEND_URL = Deno.env.get('FASTAPI_BACKEND_URL');
    
    if (!FASTAPI_BACKEND_URL) {
      console.error('❌ FASTAPI_BACKEND_URL environment variable is not set');
      return new Response(
        JSON.stringify({
          error: 'Configuration Error',
          detail: 'FastAPI backend URL is not configured. Please set FASTAPI_BACKEND_URL environment variable.'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract the path after /analytics-api/
    const url = new URL(req.url);
    const path = url.pathname.replace('/analytics-api', '');
    const searchParams = url.searchParams.toString();
    const targetUrl = `${FASTAPI_BACKEND_URL}${path}${searchParams ? `?${searchParams}` : ''}`;

    console.log(`🔄 Proxying ${req.method} request to: ${targetUrl}`);

    // Get the authorization header from the request
    const authHeader = req.headers.get('Authorization');
    
    // Prepare headers for the FastAPI request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Forward the authorization header if present
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    // Prepare the request body for non-GET requests
    let body = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        const text = await req.text();
        if (text) {
          body = text;
        }
      } catch (e) {
        console.warn('⚠️ Could not read request body:', e);
      }
    }

    // Forward the request to FastAPI
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: body,
    });

    // Get the response data
    const responseData = await response.text();
    
    console.log(`📡 FastAPI response status: ${response.status}`);
    
    // Return the response from FastAPI
    return new Response(responseData, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });

  } catch (error) {
    console.error('❌ Edge Function Error:', error);
    
    return new Response(
      JSON.stringify({
        error: 'Edge Function Error',
        detail: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// Created and developed by Jai Singh
