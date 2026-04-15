-- ============================================================
-- SCHOOL STUDENT TRANSPORT TRACKING SYSTEM
-- Database Schema — Supabase PostgreSQL
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('parent', 'driver', 'admin', 'scanner');
CREATE TYPE trip_type AS ENUM ('morning', 'evening');
CREATE TYPE trip_status AS ENUM ('pending', 'active', 'completed', 'cancelled');
CREATE TYPE scan_type AS ENUM ('MORNING_BOARD', 'SCHOOL_ARRIVAL', 'EVENING_BOARD', 'HOME_DROP');
CREATE TYPE student_status AS ENUM (
  'not_boarded',
  'boarded_morning',
  'on_way_to_school',
  'reached_school',
  'boarded_evening',
  'on_way_home',
  'reached_home'
);

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================

CREATE TABLE public.users (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL UNIQUE,
  full_name    TEXT NOT NULL,
  phone        TEXT,
  role         user_role NOT NULL DEFAULT 'parent',
  avatar_url   TEXT,
  fcm_token    TEXT,                -- Firebase Cloud Messaging token
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SCHOOLS
-- ============================================================

CREATE TABLE public.schools (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  address      TEXT,
  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,
  timezone     TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BUSES
-- ============================================================

CREATE TABLE public.buses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id     UUID NOT NULL REFERENCES public.schools(id),
  bus_number    TEXT NOT NULL UNIQUE,
  plate_number  TEXT NOT NULL,
  capacity      INT NOT NULL DEFAULT 40,
  make_model    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROUTES
-- ============================================================

CREATE TABLE public.routes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id    UUID NOT NULL REFERENCES public.schools(id),
  name         TEXT NOT NULL,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STOPS
-- ============================================================

CREATE TABLE public.stops (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  route_id     UUID NOT NULL REFERENCES public.routes(id),
  name         TEXT NOT NULL,
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  sequence_no  INT NOT NULL,         -- Order along the route
  address      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(route_id, sequence_no)
);

-- ============================================================
-- BUS–ROUTE ASSIGNMENTS
-- ============================================================

CREATE TABLE public.bus_route_assignments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bus_id       UUID NOT NULL REFERENCES public.buses(id),
  route_id     UUID NOT NULL REFERENCES public.routes(id),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(bus_id)  -- One bus → one active route
);

-- ============================================================
-- DRIVERS
-- ============================================================

CREATE TABLE public.drivers (
  id           UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  employee_id  TEXT UNIQUE,
  license_no   TEXT,
  bus_id       UUID REFERENCES public.buses(id),  -- currently assigned bus
  school_id    UUID NOT NULL REFERENCES public.schools(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PARENTS
-- ============================================================

CREATE TABLE public.parents (
  id           UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  school_id    UUID REFERENCES public.schools(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STUDENTS
-- ============================================================

CREATE TABLE public.students (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  full_name       TEXT NOT NULL,
  admission_no    TEXT NOT NULL,
  class_name      TEXT NOT NULL,
  section         TEXT,
  date_of_birth   DATE,
  photo_url       TEXT,
  qr_code         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  bus_id          UUID REFERENCES public.buses(id),
  current_status  student_status NOT NULL DEFAULT 'not_boarded',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, admission_no)
);

-- ============================================================
-- PARENT–STUDENT RELATIONSHIPS
-- ============================================================

CREATE TABLE public.parent_student (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id     UUID NOT NULL REFERENCES public.parents(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  relationship  TEXT NOT NULL DEFAULT 'parent',   -- parent / guardian / emergency
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(parent_id, student_id)
);

-- ============================================================
-- STUDENT–STOP ASSIGNMENTS
-- ============================================================

CREATE TABLE public.student_stop_assignments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  stop_id       UUID NOT NULL REFERENCES public.stops(id),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, stop_id, effective_from)
);

-- ============================================================
-- TRIP SESSIONS
-- ============================================================

CREATE TABLE public.trip_sessions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bus_id         UUID NOT NULL REFERENCES public.buses(id),
  driver_id      UUID NOT NULL REFERENCES public.drivers(id),
  route_id       UUID NOT NULL REFERENCES public.routes(id),
  trip_type      trip_type NOT NULL,
  status         trip_status NOT NULL DEFAULT 'pending',
  trip_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- At most one active trip per bus per type per day
  UNIQUE(bus_id, trip_type, trip_date, status) DEFERRABLE INITIALLY DEFERRED
);

-- ============================================================
-- SCAN EVENTS
-- ============================================================

CREATE TABLE public.scan_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_session_id   UUID NOT NULL REFERENCES public.trip_sessions(id),
  student_id        UUID NOT NULL REFERENCES public.students(id),
  bus_id            UUID NOT NULL REFERENCES public.buses(id),
  driver_id         UUID NOT NULL REFERENCES public.drivers(id),
  scan_type         scan_type NOT NULL,
  scanned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scanner_latitude  DOUBLE PRECISION,
  scanner_longitude DOUBLE PRECISION,
  scanner_accuracy  DOUBLE PRECISION,    -- GPS accuracy in metres
  scanned_by        UUID REFERENCES public.users(id),  -- who scanned (driver/admin)
  notes             TEXT,
  is_correction     BOOLEAN NOT NULL DEFAULT false,     -- admin corrected scan
  corrected_by      UUID REFERENCES public.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BUS LOCATIONS (GPS pings from driver phone)
-- ============================================================

CREATE TABLE public.bus_locations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bus_id       UUID NOT NULL REFERENCES public.buses(id),
  trip_session_id UUID REFERENCES public.trip_sessions(id),
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  accuracy     DOUBLE PRECISION,         -- metres
  speed        DOUBLE PRECISION,         -- km/h
  heading      DOUBLE PRECISION,         -- degrees 0–360
  altitude     DOUBLE PRECISION,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hypertable-style partitioning hint (manual — adjust for Supabase Pro)
CREATE INDEX idx_bus_locations_bus_recorded ON public.bus_locations(bus_id, recorded_at DESC);
CREATE INDEX idx_bus_locations_trip ON public.bus_locations(trip_session_id, recorded_at DESC);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE public.notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_id      UUID REFERENCES public.students(id),
  scan_event_id   UUID REFERENCES public.scan_events(id),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  notification_type TEXT NOT NULL,   -- MORNING_BOARD | SCHOOL_ARRIVAL | EVENING_BOARD | HOME_DROP
  is_read         BOOLEAN NOT NULL DEFAULT false,
  sent_via_fcm    BOOLEAN NOT NULL DEFAULT false,
  fcm_message_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

-- ============================================================
-- AUDIT LOGS
-- ============================================================

CREATE TABLE public.audit_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id     UUID REFERENCES public.users(id),
  action       TEXT NOT NULL,     -- 'scan_correction', 'trip_start', 'student_update' …
  table_name   TEXT NOT NULL,
  record_id    UUID,
  old_data     JSONB,
  new_data     JSONB,
  ip_address   INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_students_bus ON public.students(bus_id);
CREATE INDEX idx_students_qr ON public.students(qr_code);
CREATE INDEX idx_scan_events_student_trip ON public.scan_events(student_id, trip_session_id);
CREATE INDEX idx_scan_events_trip ON public.scan_events(trip_session_id, scanned_at DESC);
CREATE INDEX idx_trip_sessions_bus_date ON public.trip_sessions(bus_id, trip_date, trip_type);
CREATE INDEX idx_parent_student_parent ON public.parent_student(parent_id);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id, is_read) WHERE is_read = false;

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE ON AUTH SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'parent')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parents                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buses                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stops                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bus_locations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_student           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_stop_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs               ENABLE ROW LEVEL SECURITY;

-- Helper: get current user role
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role LANGUAGE sql STABLE AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$;

-- Helper: is current user an admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT current_user_role() = 'admin'
$$;

-- USERS policies
CREATE POLICY users_read_own    ON public.users FOR SELECT USING (id = auth.uid() OR is_admin());
CREATE POLICY users_update_own  ON public.users FOR UPDATE USING (id = auth.uid() OR is_admin());
CREATE POLICY users_admin_all   ON public.users FOR ALL    USING (is_admin());

-- STUDENTS policies
-- Parents see only their children; drivers see students on their bus; admin sees all
CREATE POLICY students_parent_select ON public.students FOR SELECT USING (
  is_admin()
  OR EXISTS (
    SELECT 1 FROM public.parent_student ps
    JOIN public.parents p ON ps.parent_id = p.id
    WHERE ps.student_id = students.id AND p.id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = auth.uid() AND d.bus_id = students.bus_id
  )
);
CREATE POLICY students_admin_all ON public.students FOR ALL USING (is_admin());

-- SCAN EVENTS
CREATE POLICY scan_events_parent_select ON public.scan_events FOR SELECT USING (
  is_admin()
  OR EXISTS (
    SELECT 1 FROM public.parent_student ps
    JOIN public.parents p ON ps.parent_id = p.id
    WHERE ps.student_id = scan_events.student_id AND p.id = auth.uid()
  )
  OR driver_id = auth.uid()
);
CREATE POLICY scan_events_driver_insert ON public.scan_events FOR INSERT WITH CHECK (
  driver_id = auth.uid() OR is_admin()
);

-- BUS LOCATIONS
CREATE POLICY bus_locations_driver_insert ON public.bus_locations FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = auth.uid() AND d.bus_id = bus_locations.bus_id)
  OR is_admin()
);
CREATE POLICY bus_locations_parent_select ON public.bus_locations FOR SELECT USING (
  is_admin()
  OR EXISTS (
    SELECT 1 FROM public.parent_student ps
    JOIN public.parents p   ON ps.parent_id = p.id
    JOIN public.students st ON ps.student_id = st.id
    WHERE st.bus_id = bus_locations.bus_id AND p.id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = auth.uid() AND d.bus_id = bus_locations.bus_id)
);

-- NOTIFICATIONS
CREATE POLICY notifications_own ON public.notifications FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY notifications_mark_read ON public.notifications FOR UPDATE USING (user_id = auth.uid());

-- TRIP SESSIONS
CREATE POLICY trip_sessions_driver_select ON public.trip_sessions FOR SELECT USING (
  is_admin() OR driver_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.parent_student ps
    JOIN public.parents p   ON ps.parent_id = p.id
    JOIN public.students st ON ps.student_id = st.id
    WHERE st.bus_id = trip_sessions.bus_id AND p.id = auth.uid()
  )
);
CREATE POLICY trip_sessions_driver_manage ON public.trip_sessions FOR INSERT WITH CHECK (
  driver_id = auth.uid() OR is_admin()
);
CREATE POLICY trip_sessions_driver_update ON public.trip_sessions FOR UPDATE USING (
  driver_id = auth.uid() OR is_admin()
);

-- ROUTES & STOPS (public read, admin write)
CREATE POLICY routes_read  ON public.routes FOR SELECT USING (true);
CREATE POLICY routes_admin ON public.routes FOR ALL    USING (is_admin());
CREATE POLICY stops_read   ON public.stops  FOR SELECT USING (true);
CREATE POLICY stops_admin  ON public.stops  FOR ALL    USING (is_admin());

-- SCHOOLS (public read, admin write)
CREATE POLICY schools_read  ON public.schools FOR SELECT USING (true);
CREATE POLICY schools_admin ON public.schools FOR ALL    USING (is_admin());

-- BUSES (public read, admin write)
CREATE POLICY buses_read  ON public.buses FOR SELECT USING (true);
CREATE POLICY buses_admin ON public.buses FOR ALL    USING (is_admin());

-- PARENT_STUDENT
CREATE POLICY ps_parent_read  ON public.parent_student FOR SELECT USING (parent_id = auth.uid() OR is_admin());
CREATE POLICY ps_admin_all    ON public.parent_student FOR ALL    USING (is_admin());

-- AUDIT LOGS (admin only)
CREATE POLICY audit_admin ON public.audit_logs FOR ALL USING (is_admin());

-- DRIVERS
CREATE POLICY drivers_read_own ON public.drivers FOR SELECT USING (id = auth.uid() OR is_admin());
CREATE POLICY drivers_admin    ON public.drivers FOR ALL    USING (is_admin());

-- ============================================================
-- REALTIME PUBLICATIONS
-- ============================================================

-- Enable realtime for live tracking tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.bus_locations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.students;

-- ============================================================
-- SEED: Default School (update for your deployment)
-- ============================================================

INSERT INTO public.schools (id, name, address, latitude, longitude)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Demo School',
  '123 School Road, City',
  17.3850,
  78.4867
) ON CONFLICT DO NOTHING;
