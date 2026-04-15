// ============================================================
// SCHOOL TRANSPORT TRACKER — TypeScript Types
// ============================================================

export type UserRole = 'parent' | 'driver' | 'admin' | 'scanner'
export type TripType = 'morning' | 'evening'
export type TripStatus = 'pending' | 'active' | 'completed' | 'cancelled'
export type ScanType = 'MORNING_BOARD' | 'SCHOOL_ARRIVAL' | 'EVENING_BOARD' | 'HOME_DROP'
export type StudentStatus =
  | 'not_boarded'
  | 'boarded_morning'
  | 'on_way_to_school'
  | 'reached_school'
  | 'boarded_evening'
  | 'on_way_home'
  | 'reached_home'

// ─────────────────────────────────────────────
// Database Row Types
// ─────────────────────────────────────────────

export interface User {
  id: string
  email: string
  full_name: string
  phone: string | null
  role: UserRole
  avatar_url: string | null
  fcm_token: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface School {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  timezone: string
  is_active: boolean
  created_at: string
}

export interface Bus {
  id: string
  school_id: string
  bus_number: string
  plate_number: string
  capacity: number
  make_model: string | null
  is_active: boolean
  created_at: string
}

export interface BusRouteAssignment {
  id: string
  bus_id: string
  route_id: string
  assigned_at: string
  // joined
  route?: Route
}

export interface Route {
  id: string
  school_id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
}

export interface Stop {
  id: string
  route_id: string
  name: string
  latitude: number
  longitude: number
  sequence_no: number
  address: string | null
  created_at: string
}

export interface Driver {
  id: string
  employee_id: string | null
  license_no: string | null
  bus_id: string | null
  school_id: string
  created_at: string
  // joined
  user?: User
  bus?: Bus
}

export interface Parent {
  id: string
  school_id: string | null
  created_at: string
  // joined
  user?: User
}

export interface Student {
  id: string
  school_id: string
  full_name: string
  admission_no: string
  class_name: string
  section: string | null
  date_of_birth: string | null
  photo_url: string | null
  qr_code: string
  bus_id: string | null
  current_status: StudentStatus
  is_active: boolean
  created_at: string
  updated_at: string
  // joined
  bus?: Bus
  stop?: Stop
  school?: School
}

export interface ParentStudent {
  id: string
  parent_id: string
  student_id: string
  relationship: string
  is_primary: boolean
  created_at: string
}

export interface StudentStopAssignment {
  id: string
  student_id: string
  stop_id: string
  effective_from: string
  effective_to: string | null
  is_active: boolean
  created_at: string
  // joined
  stop?: Stop
}

export interface TripSession {
  id: string
  bus_id: string
  driver_id: string
  route_id: string
  trip_type: TripType
  status: TripStatus
  trip_date: string
  started_at: string | null
  ended_at: string | null
  notes: string | null
  created_at: string
  // joined
  bus?: Bus
  driver?: Driver
  route?: Route
}

export interface ScanEvent {
  id: string
  trip_session_id: string
  student_id: string
  bus_id: string
  driver_id: string
  scan_type: ScanType
  scanned_at: string
  scanner_latitude: number | null
  scanner_longitude: number | null
  scanner_accuracy: number | null
  scanned_by: string | null
  notes: string | null
  is_correction: boolean
  corrected_by: string | null
  created_at: string
  // joined
  student?: Student
  trip_session?: TripSession
}

export interface BusLocation {
  id: string
  bus_id: string
  trip_session_id: string | null
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  altitude: number | null
  recorded_at: string
}

export interface Notification {
  id: string
  user_id: string
  student_id: string | null
  scan_event_id: string | null
  title: string
  body: string
  notification_type: string
  is_read: boolean
  sent_via_fcm: boolean
  fcm_message_id: string | null
  created_at: string
  // joined
  student?: Student
}

export interface AuditLog {
  id: string
  actor_id: string | null
  action: string
  table_name: string
  record_id: string | null
  old_data: Json | null
  new_data: Json | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

// ─────────────────────────────────────────────
// API Request / Response Types
// ─────────────────────────────────────────────

export interface StartTripRequest {
  bus_id: string
  route_id: string
  trip_type: TripType
}

export interface StartTripResponse {
  trip_session: TripSession
}

export interface ScanRequest {
  qr_code: string
  trip_session_id: string
  scanner_latitude?: number
  scanner_longitude?: number
  scanner_accuracy?: number
}

export interface ScanResponse {
  scan_event: ScanEvent
  student: Student
  message: string
  expected_scan_type: ScanType
}

export interface LocationPingRequest {
  bus_id: string
  trip_session_id: string
  latitude: number
  longitude: number
  accuracy?: number
  speed?: number
  heading?: number
  altitude?: number
}

export interface ParentDashboardData {
  students: StudentWithTracking[]
  notifications: Notification[]
}

export interface StudentWithTracking extends Student {
  latest_scan?: ScanEvent
  active_trip?: TripSession
  latest_location?: BusLocation
  assigned_stop?: Stop
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ─────────────────────────────────────────────
// Scan Sequence Logic
// ─────────────────────────────────────────────

/**
 * Returns the expected next scan type for a student given their current status.
 * Returns null if no scan is expected (e.g. already reached home).
 */
export function getExpectedScanType(status: StudentStatus): ScanType | null {
  const map: Record<StudentStatus, ScanType | null> = {
    not_boarded:    'MORNING_BOARD',
    boarded_morning:'SCHOOL_ARRIVAL',
    on_way_to_school:'SCHOOL_ARRIVAL',
    reached_school: 'EVENING_BOARD',
    boarded_evening:'HOME_DROP',
    on_way_home:    'HOME_DROP',
    reached_home:   null,
  }
  return map[status]
}

/**
 * Returns the new student status after a successful scan.
 */
export function getStatusAfterScan(scanType: ScanType): StudentStatus {
  const map: Record<ScanType, StudentStatus> = {
    MORNING_BOARD:  'boarded_morning',
    SCHOOL_ARRIVAL: 'reached_school',
    EVENING_BOARD:  'boarded_evening',
    HOME_DROP:      'reached_home',
  }
  return map[scanType]
}

/**
 * Returns a human-readable label for a student status.
 */
export function getStatusLabel(status: StudentStatus): string {
  const map: Record<StudentStatus, string> = {
    not_boarded:     'Not Boarded',
    boarded_morning: 'Boarded Bus',
    on_way_to_school:'On the Way to School',
    reached_school:  'Reached School',
    boarded_evening: 'Boarded Bus for Home',
    on_way_home:     'On the Way Home',
    reached_home:    'Reached Home',
  }
  return map[status]
}

/**
 * Returns the notification message for a scan event.
 */
export function getNotificationMessage(
  scanType: ScanType,
  studentName: string,
  busNumber: string,
  time: string
): { title: string; body: string } {
  const messages: Record<ScanType, { title: string; body: string }> = {
    MORNING_BOARD: {
      title: 'Boarded Bus',
      body: `${studentName} boarded Bus ${busNumber} at ${time}.`,
    },
    SCHOOL_ARRIVAL: {
      title: 'Reached School',
      body: `${studentName} reached school safely at ${time}.`,
    },
    EVENING_BOARD: {
      title: 'Heading Home',
      body: `${studentName} boarded the bus for home at ${time}.`,
    },
    HOME_DROP: {
      title: 'Reached Home',
      body: `${studentName} reached home safely at ${time}.`,
    },
  }
  return messages[scanType]
}

/**
 * Returns the color class for a student status badge.
 */
export function getStatusColor(status: StudentStatus): string {
  const map: Record<StudentStatus, string> = {
    not_boarded:     'bg-gray-100 text-gray-700',
    boarded_morning: 'bg-blue-100 text-blue-700',
    on_way_to_school:'bg-blue-100 text-blue-700',
    reached_school:  'bg-green-100 text-green-700',
    boarded_evening: 'bg-orange-100 text-orange-700',
    on_way_home:     'bg-orange-100 text-orange-700',
    reached_home:    'bg-emerald-100 text-emerald-700',
  }
  return map[status]
}

// ─────────────────────────────────────────────
// Supabase Database type helper
// ─────────────────────────────────────────────

type TableDefinition<Row> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

export type Database = {
  public: {
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      user_role: UserRole
      trip_type: TripType
      trip_status: TripStatus
      scan_type: ScanType
      student_status: StudentStatus
    }
    CompositeTypes: Record<string, never>
    Tables: {
      users: TableDefinition<User>
      schools: TableDefinition<School>
      buses: TableDefinition<Bus>
      routes: TableDefinition<Route>
      stops: TableDefinition<Stop>
      bus_route_assignments: TableDefinition<BusRouteAssignment>
      drivers: TableDefinition<Driver>
      parents: TableDefinition<Parent>
      students: TableDefinition<Student>
      parent_student: TableDefinition<ParentStudent>
      student_stop_assignments: TableDefinition<StudentStopAssignment>
      trip_sessions: TableDefinition<TripSession>
      scan_events: TableDefinition<ScanEvent>
      bus_locations: TableDefinition<BusLocation>
      notifications: TableDefinition<Notification>
      audit_logs: TableDefinition<AuditLog>
    }
  }
}
