import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing Supabase credentials in environment");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function seed() {
  console.log("Seeding test data...");

  // 1. Create a School
  console.log("Setting up School...");
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .upsert({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Demo School',
      address: '123 School Road, City',
      latitude: 17.3850,
      longitude: 78.4867
    }, { onConflict: 'id' })
    .select().single();
  if (schoolErr) console.error("School error:", schoolErr);

  // 2. Create a Route
  console.log("Setting up Route...");
  const { data: route, error: routeErr } = await supabase
    .from('routes')
    .upsert({
      id: '11111111-1111-1111-1111-111111111111',
      school_id: school.id,
      name: 'Route 1 (Morning)'
    }, { onConflict: 'id' }).select().single();
  if (routeErr) console.error("Route error:", routeErr);

  // 3. Create Stops
  console.log("Setting up Stops...");
  const { error: stopErr } = await supabase
    .from('stops')
    .upsert([{
      id: '22222222-2222-2222-2222-222222222222',
      route_id: route.id,
      name: 'Stop A',
      latitude: 17.3900,
      longitude: 78.4900,
      sequence_no: 1
    }, {
      id: '33333333-3333-3333-3333-333333333333',
      route_id: route.id,
      name: 'Stop B',
      latitude: 17.3950,
      longitude: 78.4950,
      sequence_no: 2
    }], { onConflict: 'id' });
  if (stopErr) console.error("Stops error:", stopErr);

  // 4. Create a Bus
  console.log("Setting up Bus...");
  const { data: bus, error: busErr } = await supabase
    .from('buses')
    .upsert({
      id: '44444444-4444-4444-4444-444444444444',
      school_id: school.id,
      bus_number: 'BUS-01',
      plate_number: 'AB 12 CD 3456',
      capacity: 40
    }, { onConflict: 'id' }).select().single();
  if (busErr) console.error("Bus error:", busErr);

  // 5. Create Bus Route Assignment
  console.log("Setting up Bus-Route Assignment...");
  const { error: braErr } = await supabase
    .from('bus_route_assignments')
    .upsert({
      bus_id: bus.id,
      route_id: route.id
    }, { onConflict: 'bus_id' });
  if (braErr) console.error("BRA error:", braErr);

  // Helper to create users
  async function createTestUser(email, password, role, fullName) {
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role, full_name: fullName }
    });

    if (authErr && authErr.message !== 'User already registered') {
      console.error(`Auth error for ${email}:`, authErr);
      return null;
    }

    let user;
    if (authData?.user) {
      user = authData.user;
      // The trigger creates the public.users record
    } else {
      // Find existing
      const { data: existing } = await supabase.auth.admin.listUsers();
      user = existing?.users.find(u => u.email === email);
    }
    return user;
  }

  // 6. Create Driver User
  console.log("Setting up Driver...");
  const driverUser = await createTestUser('driver@test.com', 'password123', 'driver', 'Test Driver');
  if (driverUser) {
    const { error: driverErr } = await supabase
      .from('drivers')
      .upsert({
        id: driverUser.id,
        employee_id: 'DRV-001',
        bus_id: bus.id,
        school_id: school.id
      }, { onConflict: 'id' });
    if (driverErr) console.error("Driver profile error:", driverErr);
  }

  // 7. Create Parent User
  console.log("Setting up Parent...");
  const parentUser = await createTestUser('parent@test.com', 'password123', 'parent', 'Test Parent');
  if (parentUser) {
    const { error: parentErr } = await supabase
      .from('parents')
      .upsert({
        id: parentUser.id,
        school_id: school.id
      }, { onConflict: 'id' });
    if (parentErr) console.error("Parent profile error:", parentErr);
  }

  // 8. Create a Student
  console.log("Setting up Student...");
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .upsert({
      id: '55555555-5555-5555-5555-555555555555',
      school_id: school.id,
      full_name: 'Test Student',
      admission_no: 'ADM-001',
      class_name: '5',
      section: 'A',
      bus_id: bus.id
    }, { onConflict: 'id' }).select().single();
  if (studentErr) console.error("Student error:", studentErr);

  // 9. Link Parent & Student
  if (parentUser && student) {
    console.log("Linking Parent and Student...");
    const { error: linkErr } = await supabase
      .from('parent_student')
      .upsert({
        parent_id: parentUser.id,
        student_id: student.id,
        relationship: 'parent',
        is_primary: true
      }, { onConflict: 'parent_id,student_id' });
    if (linkErr) console.error("Link error:", linkErr);
  }

  console.log("Seeding complete!");
  console.log("Credentials to test:");
  console.log("Driver: driver@test.com / password123");
  console.log("Parent: parent@test.com / password123");
}

seed().catch(console.error);
