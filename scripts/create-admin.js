/**
 * Admin Account Creation Script for j.AI OneBox
 * 
 * This script creates an admin user account programmatically using Supabase Admin API.
 * 
 * Prerequisites:
 * 1. Service Role Key from Supabase Dashboard (Settings > API > service_role)
 * 2. Set API_SUPABASE_SERVICE_ROLE_KEY in your environment
 * 
 * Usage:
 * node scripts/create-admin.js
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.API_SUPABASE_URL || '<YOUR_SUPABASE_URL>'
// You can also pass the key as an argument: node scripts/create-admin.js YOUR_SERVICE_KEY
const supabaseServiceKey = process.argv[2] || process.env.API_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

// Admin account configuration
const ADMIN_CONFIG = {
  email: 'admin@j.ai',
  password: 'AdminPassword123!',
  firstName: 'Admin',
  lastName: 'User'
}

async function createAdminAccount() {
  if (!supabaseServiceKey) {
    console.error('❌ API_SUPABASE_SERVICE_ROLE_KEY environment variable is required')
    console.log('\n📖 To get your service role key:')
    console.log('1. Go to https://supabase.com/dashboard/project/wncpqxwmbxjgxvrpcake/settings/api')
    console.log('2. Copy the "service_role" key (secret)')
    console.log('3. Set API_SUPABASE_SERVICE_ROLE_KEY=your_key_here in your environment')
    console.log('4. Run this script again')
    process.exit(1)
  }

  // Create admin client
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })

  try {
    console.log('🚀 Creating admin account for j.AI OneBox...')
    
    // Get organization ID
    console.log('📋 Fetching organization...')
    const { data: orgs, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .limit(1)
      .single()
    
    if (orgError) {
      console.error('❌ Error fetching organization:', orgError.message)
      return
    }
    
    console.log('✅ Found organization:', orgs.name, '(ID:', orgs.id, ')')
    
    // Check if admin user already exists in auth.users
    console.log('🔍 Checking for existing users...')
    const { data: existingAuthUsers, error: checkAuthError } = await supabase.auth.admin.listUsers()
    
    if (checkAuthError) {
      console.error('❌ Error checking existing users:', checkAuthError.message)
      return
    }
    
    const existingUser = existingAuthUsers?.users?.find(user => user.email === ADMIN_CONFIG.email)
    
    console.log('📊 Found', existingAuthUsers?.users?.length || 0, 'existing users')
    
    if (existingUser) {
      console.log('⚠️  Auth user already exists:', existingUser.email)
      
      // Check if profile exists
      const { data: existingProfile } = await supabase
        .from('user_profiles')
        .select('email, role')
        .eq('email', ADMIN_CONFIG.email)
        .single()
      
      if (existingProfile) {
        console.log('✅ Complete admin account already exists:', existingProfile.email, '(Role:', existingProfile.role, ')')
        console.log('🌐 You can login at: http://localhost:5173/sign-in')
        return
      } else {
        console.log('🔧 Creating missing user profile...')
        // Create just the profile for existing auth user
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .insert({
            id: existingUser.id,
            organization_id: orgs.id,
            email: ADMIN_CONFIG.email,
            first_name: ADMIN_CONFIG.firstName,
            last_name: ADMIN_CONFIG.lastName,
            role: 'admin',
            status: 'active',
            email_verified: true
          })
          .select()
          .single()
        
        if (profileError) {
          console.error('❌ Error creating user profile:', profileError.message)
          return
        }
        
        console.log('✅ User profile created for existing auth user!')
        console.log('\n🎉 Admin Account Setup Complete!')
        console.log('📧 Email:', ADMIN_CONFIG.email)
        console.log('👤 Role: admin')
        console.log('🌐 Login at: http://localhost:5173/sign-in')
        return
      }
    }
    
    // Create auth user using Supabase Admin API
    console.log('👤 Creating auth user...')
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: ADMIN_CONFIG.email,
      password: ADMIN_CONFIG.password,
      email_confirm: true,
      user_metadata: {
        first_name: ADMIN_CONFIG.firstName,
        last_name: ADMIN_CONFIG.lastName,
        role: 'admin'
      },
      app_metadata: {
        provider: 'email',
        providers: ['email']
      }
    })
    
    if (authError) {
      console.error('❌ Error creating auth user:', authError.message)
      console.log('🔧 Error details:', authError)
      
      // Try alternative approach if user creation fails
      console.log('🔄 Attempting alternative user creation...')
      return
    }
    
    console.log('✅ Auth user created:', authUser.user.email)
    
    // Create user profile with admin role
    console.log('📝 Creating user profile...')
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        id: authUser.user.id,
        organization_id: orgs.id,
        email: ADMIN_CONFIG.email,
        first_name: ADMIN_CONFIG.firstName,
        last_name: ADMIN_CONFIG.lastName,
        role: 'admin',
        status: 'active',
        email_verified: true
      })
      .select()
      .single()
    
    if (profileError) {
      console.error('❌ Error creating user profile:', profileError.message)
      // Clean up auth user if profile creation fails
      console.log('🧹 Cleaning up auth user...')
      await supabase.auth.admin.deleteUser(authUser.user.id)
      return
    }
    
    console.log('✅ User profile created successfully!')
    console.log('\n🎉 Admin Account Created Successfully!')
    console.log('┌─────────────────────────────────────┐')
    console.log('│           LOGIN CREDENTIALS         │')
    console.log('├─────────────────────────────────────┤')
    console.log('│ Email:    ', ADMIN_CONFIG.email.padEnd(20), '│')
    console.log('│ Password: ', ADMIN_CONFIG.password.padEnd(20), '│')
    console.log('│ Role:     admin                     │')
    console.log('│ Org:      ', orgs.name.padEnd(20), '│')
    console.log('└─────────────────────────────────────┘')
    console.log('\n⚠️  IMPORTANT: Change this password after first login!')
    console.log('🌐 Login at: http://localhost:5173/sign-in')
    
  } catch (error) {
    console.error('❌ Unexpected error:', error.message)
  }
}

createAdminAccount()
