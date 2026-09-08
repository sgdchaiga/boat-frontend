/*
  # Hotel Management System Schema

  ## Overview
  Complete database schema for a hotel management system with authentication,
  room management, reservations, check-ins, billing, and housekeeping.

  ## New Tables

  ### 1. `staff`
  Staff/employee information linked to auth.users
  - `id` (uuid, FK to auth.users)
  - `full_name` (text)
  - `email` (text)
  - `role` (text) - admin, manager, receptionist, housekeeping
  - `phone` (text)
  - `is_active` (boolean)
  - `created_at` (timestamptz)

  ### 2. `room_types`
  Categories of rooms available
  - `id` (uuid, PK)
  - `name` (text) - Single, Double, Suite, etc.
  - `description` (text)
  - `base_price` (decimal)
  - `max_occupancy` (integer)
  - `amenities` (text[])
  - `created_at` (timestamptz)

  ### 3. `rooms`
  Individual room inventory
  - `id` (uuid, PK)
  - `room_number` (text, unique)
  - `room_type_id` (uuid, FK)
  - `floor` (integer)
  - `status` (text) - available, occupied, maintenance, cleaning
  - `created_at` (timestamptz)

  ### 4. `guests`
  Guest information database
  - `id` (uuid, PK)
  - `first_name` (text)
  - `last_name` (text)
  - `email` (text)
  - `phone` (text)
  - `id_type` (text)
  - `id_number` (text)
  - `address` (text)
  - `created_at` (timestamptz)

  ### 5. `reservations`
  Booking records
  - `id` (uuid, PK)
  - `guest_id` (uuid, FK)
  - `room_id` (uuid, FK)
  - `check_in_date` (date)
  - `check_out_date` (date)
  - `status` (text) - pending, confirmed, checked_in, checked_out, cancelled
  - `number_of_guests` (integer)
  - `special_requests` (text)
  - `created_by` (uuid, FK to staff)
  - `created_at` (timestamptz)

  ### 6. `stays`
  Active check-ins and stays
  - `id` (uuid, PK)
  - `reservation_id` (uuid, FK)
  - `room_id` (uuid, FK)
  - `guest_id` (uuid, FK)
  - `actual_check_in` (timestamptz)
  - `actual_check_out` (timestamptz)
  - `checked_in_by` (uuid, FK to staff)
  - `checked_out_by` (uuid, FK to staff)
  - `created_at` (timestamptz)

  ### 7. `billing`
  Charges and invoices
  - `id` (uuid, PK)
  - `stay_id` (uuid, FK)
  - `description` (text)
  - `amount` (decimal)
  - `charge_type` (text) - room, service, food, other
  - `charged_at` (timestamptz)
  - `created_by` (uuid, FK to staff)

  ### 8. `payments`
  Payment records
  - `id` (uuid, PK)
  - `stay_id` (uuid, FK)
  - `amount` (decimal)
  - `payment_method` (text) - cash, card, bank_transfer
  - `payment_status` (text) - pending, completed, failed, refunded
  - `transaction_id` (text)
  - `paid_at` (timestamptz)
  - `processed_by` (uuid, FK to staff)

  ### 9. `housekeeping_tasks`
  Room cleaning and maintenance tasks
  - `id` (uuid, PK)
  - `room_id` (uuid, FK)
  - `task_type` (text) - cleaning, maintenance, inspection
  - `status` (text) - pending, in_progress, completed
  - `priority` (text) - low, medium, high, urgent
  - `notes` (text)
  - `assigned_to` (uuid, FK to staff)
  - `completed_at` (timestamptz)
  - `created_at` (timestamptz)

  ## Security
  - Enable RLS on all tables
  - Policies for authenticated staff members based on roles
*/

-- Create staff table
CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name text NOT NULL,
  email text UNIQUE NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'receptionist', 'housekeeping')),
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create room_types table
CREATE TABLE IF NOT EXISTS room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  base_price decimal(10,2) NOT NULL,
  max_occupancy integer NOT NULL DEFAULT 2,
  amenities text[],
  created_at timestamptz DEFAULT now()
);

-- Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number text UNIQUE NOT NULL,
  room_type_id uuid REFERENCES room_types(id) ON DELETE RESTRICT,
  floor integer NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance', 'cleaning')),
  created_at timestamptz DEFAULT now()
);

-- Create guests table
CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  id_type text,
  id_number text,
  address text,
  created_at timestamptz DEFAULT now()
);

-- Create reservations table
CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid REFERENCES guests(id) ON DELETE CASCADE,
  room_id uuid REFERENCES rooms(id) ON DELETE RESTRICT,
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled')),
  number_of_guests integer NOT NULL DEFAULT 1,
  special_requests text,
  created_by uuid REFERENCES staff(id),
  created_at timestamptz DEFAULT now(),
  CHECK (check_out_date > check_in_date)
);

-- Create stays table
CREATE TABLE IF NOT EXISTS stays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE,
  room_id uuid REFERENCES rooms(id) ON DELETE RESTRICT,
  guest_id uuid REFERENCES guests(id) ON DELETE CASCADE,
  actual_check_in timestamptz DEFAULT now(),
  actual_check_out timestamptz,
  checked_in_by uuid REFERENCES staff(id),
  checked_out_by uuid REFERENCES staff(id),
  created_at timestamptz DEFAULT now()
);

-- Create billing table
CREATE TABLE IF NOT EXISTS billing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_id uuid REFERENCES stays(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount decimal(10,2) NOT NULL,
  charge_type text NOT NULL CHECK (charge_type IN ('room', 'service', 'food', 'other')),
  charged_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES staff(id)
);

-- Create payments table
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_id uuid REFERENCES stays(id) ON DELETE CASCADE,
  amount decimal(10,2) NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'card', 'bank_transfer')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  transaction_id text,
  paid_at timestamptz DEFAULT now(),
  processed_by uuid REFERENCES staff(id)
);

-- Create housekeeping_tasks table
CREATE TABLE IF NOT EXISTS housekeeping_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('cleaning', 'maintenance', 'inspection')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  notes text,
  assigned_to uuid REFERENCES staff(id),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_reservations_dates ON reservations(check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_stays_check_out ON stays(actual_check_out);
CREATE INDEX IF NOT EXISTS idx_housekeeping_status ON housekeeping_tasks(status);

-- Enable Row Level Security
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stays ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE housekeeping_tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for staff table
CREATE POLICY "Staff can view all staff members"
  ON staff FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  );

CREATE POLICY "Admins can insert staff"
  ON staff FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role = 'admin'
    )
  );

CREATE POLICY "Admins can update staff"
  ON staff FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role = 'admin'
    )
  );

-- RLS Policies for room_types
CREATE POLICY "Authenticated staff can view room types"
  ON room_types FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  );

CREATE POLICY "Managers and admins can manage room types"
  ON room_types FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager')
    )
  );

-- RLS Policies for rooms
CREATE POLICY "Authenticated staff can view rooms"
  ON rooms FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  );

CREATE POLICY "Managers and admins can manage rooms"
  ON rooms FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Staff can update room status"
  ON rooms FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  );

-- RLS Policies for guests
CREATE POLICY "Authenticated staff can view guests"
  ON guests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  );

CREATE POLICY "Receptionists and above can manage guests"
  ON guests FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager', 'receptionist')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager', 'receptionist')
    )
  );

-- RLS Policies for reservations
CREATE POLICY "Authenticated staff can view reservations"
  ON reservations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  );

CREATE POLICY "Receptionists and above can manage reservations"
  ON reservations FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager', 'receptionist')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager', 'receptionist')
    )
  );

-- RLS Policies for stays
CREATE POLICY "Authenticated staff can view stays"
  ON stays FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  );

CREATE POLICY "Receptionists and above can manage stays"
  ON stays FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager', 'receptionist')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager', 'receptionist')
    )
  );

-- RLS Policies for billing
CREATE POLICY "Authenticated staff can view billing"
  ON billing FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  );

CREATE POLICY "Receptionists and above can manage billing"
  ON billing FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager', 'receptionist')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager', 'receptionist')
    )
  );

-- RLS Policies for payments
CREATE POLICY "Authenticated staff can view payments"
  ON payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  );

CREATE POLICY "Receptionists and above can manage payments"
  ON payments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager', 'receptionist')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager', 'receptionist')
    )
  );

-- RLS Policies for housekeeping_tasks
CREATE POLICY "Authenticated staff can view housekeeping tasks"
  ON housekeeping_tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid()
    )
  );

CREATE POLICY "Managers can manage housekeeping tasks"
  ON housekeeping_tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Assigned staff can update their tasks"
  ON housekeeping_tasks FOR UPDATE
  TO authenticated
  USING (
    assigned_to = auth.uid() OR EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    assigned_to = auth.uid() OR EXISTS (
      SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.role IN ('admin', 'manager')
    )
  );