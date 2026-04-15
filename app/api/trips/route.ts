import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { StartTripRequest } from '@/lib/types'

// POST /api/trips — start a trip session
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify driver role
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('*, bus:buses(*), user:users(*)')
    .eq('id', user.id)
    .single()

  if (driverError || !driver) {
    return NextResponse.json({ error: 'Driver profile not found' }, { status: 403 })
  }

  const body: StartTripRequest = await request.json()
  const { bus_id, route_id, trip_type } = body

  if (!bus_id || !route_id || !trip_type) {
    return NextResponse.json({ error: 'bus_id, route_id, and trip_type are required' }, { status: 400 })
  }

  // Ensure driver is assigned to this bus
  if (driver.bus_id !== bus_id) {
    return NextResponse.json({ error: 'Bus not assigned to this driver' }, { status: 403 })
  }

  const today = new Date().toISOString().split('T')[0]

  // Check for an already-active trip of the same type today
  const { data: existing } = await supabase
    .from('trip_sessions')
    .select('id, status')
    .eq('bus_id', bus_id)
    .eq('trip_type', trip_type)
    .eq('trip_date', today)
    .in('status', ['pending', 'active'])
    .single()

  if (existing) {
    return NextResponse.json(
      { error: `A ${trip_type} trip is already active for this bus today`, trip_session_id: existing.id },
      { status: 409 }
    )
  }

  // Create the trip session
  const { data: session, error: insertError } = await supabase
    .from('trip_sessions')
    .insert({
      bus_id,
      driver_id: user.id,
      route_id,
      trip_type,
      status: 'active',
      trip_date: today,
      started_at: new Date().toISOString(),
    })
    .select('*, bus:buses(*), driver:drivers(*, user:users(*)), route:routes(*)')
    .single()

  if (insertError || !session) {
    console.error('[Trips] Insert error:', insertError)
    return NextResponse.json({ error: 'Failed to create trip session' }, { status: 500 })
  }

  // Audit log
  await supabase.from('audit_logs').insert({
    actor_id: user.id,
    action: 'trip_start',
    table_name: 'trip_sessions',
    record_id: session.id,
    new_data: { trip_type, bus_id, route_id },
  })

  return NextResponse.json({ trip_session: session }, { status: 201 })
}

// GET /api/trips?bus_id=&date=&status=
export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const bus_id = searchParams.get('bus_id')
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const status = searchParams.get('status')

  let query = supabase
    .from('trip_sessions')
    .select('*, bus:buses(*), driver:drivers(*, user:users(*)), route:routes(*)')
    .eq('trip_date', date)
    .order('created_at', { ascending: false })

  if (bus_id) query = query.eq('bus_id', bus_id)
  if (status) query = query.eq('status', status)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ trips: data })
}

// PATCH /api/trips — end a trip
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { trip_session_id, action } = await request.json()

  if (!trip_session_id || !['end', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'trip_session_id and action (end|cancel) required' }, { status: 400 })
  }

  const { data: session, error: fetchError } = await supabase
    .from('trip_sessions')
    .select('*')
    .eq('id', trip_session_id)
    .eq('status', 'active')
    .single()

  if (fetchError || !session) {
    return NextResponse.json({ error: 'Active trip session not found' }, { status: 404 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('trip_sessions')
    .update({
      status: action === 'end' ? 'completed' : 'cancelled',
      ended_at: new Date().toISOString(),
    })
    .eq('id', trip_session_id)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  await supabase.from('audit_logs').insert({
    actor_id: user.id,
    action: `trip_${action}`,
    table_name: 'trip_sessions',
    record_id: trip_session_id,
    old_data: { status: 'active' },
    new_data: { status: updated?.status },
  })

  return NextResponse.json({ trip_session: updated })
}
