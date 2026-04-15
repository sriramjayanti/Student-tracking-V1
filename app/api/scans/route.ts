import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { notifyParent } from '@/lib/firebase/fcm'
import {
  getExpectedScanType,
  getStatusAfterScan,
  getNotificationMessage,
  type ScanType,
  type ScanRequest,
} from '@/lib/types'
import { format } from 'date-fns'

// POST /api/scans — process a QR scan
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const adminClient = await createAdminClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body: ScanRequest = await request.json()
  const { qr_code, trip_session_id, scanner_latitude, scanner_longitude, scanner_accuracy } = body

  if (!qr_code || !trip_session_id) {
    return NextResponse.json({ error: 'qr_code and trip_session_id are required' }, { status: 400 })
  }

  // ── 1. Load the trip session ──────────────────────────────────────────────
  const { data: tripSession, error: tripError } = await supabase
    .from('trip_sessions')
    .select('*, bus:buses(*)')
    .eq('id', trip_session_id)
    .eq('status', 'active')
    .single()

  if (tripError || !tripSession) {
    return NextResponse.json({ error: 'No active trip session found' }, { status: 404 })
  }

  // ── 2. Validate the QR and load student ──────────────────────────────────
  const trimmedQR = qr_code.trim()
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('*, bus:buses(*)')
    .or(`qr_code.eq."${trimmedQR}",admission_no.eq."${trimmedQR}"`)
    .eq('is_active', true)
    .single()

  if (studentError || !student) {
    console.error('[Scan] Lookup failed for QR:', trimmedQR, studentError)
    return NextResponse.json({ error: 'Invalid or unregistered QR code' }, { status: 404 })
  }

  // ── 3. Verify student is on this bus ────────────────────────────────────
  if (student.bus_id !== tripSession.bus_id) {
    await adminClient.from('audit_logs').insert({
      actor_id: user.id,
      action: 'scan_wrong_bus',
      table_name: 'scan_events',
      record_id: student.id,
      new_data: {
        student_bus_id: student.bus_id,
        trip_bus_id: tripSession.bus_id,
      },
    })
    return NextResponse.json(
      { error: `Student is assigned to a different bus (${student.bus?.bus_number ?? 'unknown'})` },
      { status: 422 }
    )
  }

  // ── 4. Determine expected scan type based on current status ─────────────
  const expectedScanType = getExpectedScanType(student.current_status)

  if (!expectedScanType) {
    return NextResponse.json(
      { error: 'Student has already completed all scans for today' },
      { status: 422 }
    )
  }

  // ── 5. Validate trip type matches scan type ──────────────────────────────
  const morningScans: ScanType[] = ['MORNING_BOARD', 'SCHOOL_ARRIVAL']
  const eveningScans: ScanType[] = ['EVENING_BOARD', 'HOME_DROP']

  const isMorningTrip = tripSession.trip_type === 'morning'
  const isScanForThisTrip = isMorningTrip
    ? morningScans.includes(expectedScanType)
    : eveningScans.includes(expectedScanType)

  if (!isScanForThisTrip) {
    return NextResponse.json(
      {
        error: `Invalid scan sequence. Expected ${expectedScanType} but this is a ${tripSession.trip_type} trip.`,
        current_status: student.current_status,
        expected_scan_type: expectedScanType,
      },
      { status: 422 }
    )
  }

  // ── 6. Insert the scan event ─────────────────────────────────────────────
  const { data: scanEvent, error: scanError } = await adminClient
    .from('scan_events')
    .insert({
      trip_session_id,
      student_id: student.id,
      bus_id: tripSession.bus_id,
      driver_id: tripSession.driver_id,
      scan_type: expectedScanType,
      scanner_latitude: scanner_latitude ?? null,
      scanner_longitude: scanner_longitude ?? null,
      scanner_accuracy: scanner_accuracy ?? null,
      scanned_by: user.id,
    })
    .select()
    .single()

  if (scanError || !scanEvent) {
    console.error('[Scan] Insert error:', scanError)
    return NextResponse.json({ error: 'Failed to record scan' }, { status: 500 })
  }

  // ── 7. Update student status ─────────────────────────────────────────────
  const newStatus = getStatusAfterScan(expectedScanType)
  await adminClient
    .from('students')
    .update({ current_status: newStatus })
    .eq('id', student.id)

  // ── 8. Notify parents ────────────────────────────────────────────────────
  const scannedTime = format(new Date(), 'hh:mm a')
  const busNumber = (tripSession as any).bus?.bus_number ?? ''
  const { title, body: messageBody } = getNotificationMessage(
    expectedScanType,
    student.full_name,
    busNumber,
    scannedTime
  )

  // Get all parents of this student with FCM tokens
  const { data: parentLinks } = await adminClient
    .from('parent_student')
    .select('parent_id, parent:parents!inner(id, user:users!inner(id, full_name, fcm_token))')
    .eq('student_id', student.id)

  const fcmPromises: Promise<void>[] = []

  for (const link of parentLinks ?? []) {
    const parentUser = (link as any).parent?.user
    if (!parentUser) continue

    // Store notification in DB
    const notifInsert = adminClient.from('notifications').insert({
      user_id: parentUser.id,
      student_id: student.id,
      scan_event_id: scanEvent.id,
      title,
      body: messageBody,
      notification_type: expectedScanType,
      sent_via_fcm: !!parentUser.fcm_token,
    })

    fcmPromises.push(
      (async () => {
        await notifInsert
      })()
    )

    // Send FCM push if token available
    if (parentUser.fcm_token) {
      fcmPromises.push(
        notifyParent({
          fcmToken: parentUser.fcm_token,
          scanType: expectedScanType,
          studentName: student.full_name,
          busNumber,
          time: scannedTime,
          studentId: student.id,
          scanEventId: scanEvent.id,
        }).then(() => undefined)
      )
    }
  }

  // Fire notifications concurrently — don't block the response
  Promise.allSettled(fcmPromises).catch(console.error)

  return NextResponse.json(
    {
      scan_event: scanEvent,
      student: { ...student, current_status: newStatus },
      message: `${student.full_name} — ${expectedScanType.replace(/_/g, ' ')} recorded`,
      expected_scan_type: expectedScanType,
    },
    { status: 201 }
  )
}

// GET /api/scans?trip_session_id= or ?student_id=
export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const trip_session_id = searchParams.get('trip_session_id')
  const student_id = searchParams.get('student_id')
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  let query = supabase
    .from('scan_events')
    .select(`
      *,
      student:students(id, full_name, class_name, photo_url, current_status),
      trip_session:trip_sessions(id, trip_type, trip_date, bus:buses(bus_number))
    `)
    .order('scanned_at', { ascending: false })

  if (trip_session_id) query = query.eq('trip_session_id', trip_session_id)
  if (student_id) query = query.eq('student_id', student_id)
  if (!trip_session_id && !student_id) {
    // default: today's scans visible to this user (RLS will filter)
    query = query.gte('scanned_at', `${date}T00:00:00Z`).lte('scanned_at', `${date}T23:59:59Z`)
  }

  const { data, error } = await query.limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ scans: data })
}
