import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/notifications?limit=20&unread_only=true
export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)
  const unreadOnly = searchParams.get('unread_only') === 'true'

  let query = supabase
    .from('notifications')
    .select('*, student:students(id, full_name, class_name, photo_url)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) {
    query = query.eq('is_read', false)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Unread count
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false)

  return NextResponse.json({ notifications: data, unread_count: count ?? 0 })
}

// PATCH /api/notifications — mark as read
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { notification_ids, mark_all } = await request.json()

  if (mark_all) {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
  } else if (Array.isArray(notification_ids) && notification_ids.length > 0) {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('id', notification_ids)
      .eq('user_id', user.id)
  } else {
    return NextResponse.json({ error: 'Provide notification_ids array or mark_all: true' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

// POST /api/notifications/fcm-token — save FCM token
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { fcm_token } = await request.json()

  if (!fcm_token) {
    return NextResponse.json({ error: 'fcm_token is required' }, { status: 400 })
  }

  await supabase
    .from('users')
    .update({ fcm_token })
    .eq('id', user.id)

  return NextResponse.json({ ok: true })
}
