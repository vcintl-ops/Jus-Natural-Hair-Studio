-- ============================================================
-- Jus Natural Hair Studio — Supabase database schema
-- ============================================================
-- HOW TO USE:
-- 1. In your Supabase project, open the "SQL Editor" (left sidebar).
-- 2. Before running this, find the line near the bottom that says
--    'owner@example.com' and change it to YOUR real email address.
-- 3. Click "New query", paste this whole file in, click "Run".
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_head boolean not null default false
);

create table services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null default 0,
  duration int not null default 30,
  commissioned boolean not null default true
);

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null default 0,
  beneficiary text not null default 'salon' check (beneficiary in ('salon','staff'))
);

create table staff_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text unique not null,
  first_name text not null default '',
  last_name text not null default '',
  role text not null default 'stylist' check (role in ('owner','receptionist','stylist')),
  branch_id uuid references branches(id),
  pay_type text not null default 'commission_only' check (pay_type in ('fixed','commission_only','base_plus_commission')),
  base_wage numeric not null default 0,
  commission_rate numeric not null default 0,
  status text not null default 'invited' check (status in ('invited','active')),
  invite_code text unique,
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id),
  first_name text not null default '',
  last_name text not null default '',
  nickname text not null,
  phone text not null,
  birthday date,
  email text,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id),
  staff_id uuid references staff_profiles(id),
  client_id uuid references clients(id),
  service_id uuid references services(id),
  date date not null,
  start_time text not null,
  duration int not null default 30,
  status text not null default 'booked' check (status in ('booked','confirmed','on_the_way','completed','cancelled','voided')),
  payments jsonb not null default '[]',
  service_amount numeric not null default 0,
  products jsonb not null default '[]',
  products_total numeric not null default 0,
  paid_total numeric not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index appointments_branch_date_idx on appointments (branch_id, date);

create table out_of_office (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff_profiles(id),
  start_date date not null,
  end_date date not null,
  reason text not null default ''
);

create table promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null default '',
  body text not null default '',
  trigger text not null default 'manual' check (trigger in ('new_client_email','manual')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table automation_log (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid references promotions(id),
  promotion_name text,
  client_id uuid references clients(id),
  client_email text,
  sent_at timestamptz not null default now()
);

-- ---------- Helper functions (used inside security policies) ----------

create or replace function my_staff_id() returns uuid
language sql security definer set search_path = public stable as $$
  select id from staff_profiles where auth_user_id = auth.uid()
$$;

create or replace function my_role() returns text
language sql security definer set search_path = public stable as $$
  select role from staff_profiles where auth_user_id = auth.uid()
$$;

create or replace function my_branch() returns uuid
language sql security definer set search_path = public stable as $$
  select branch_id from staff_profiles where auth_user_id = auth.uid()
$$;

-- ---------- Row Level Security ----------

alter table branches enable row level security;
alter table services enable row level security;
alter table products enable row level security;
alter table staff_profiles enable row level security;
alter table clients enable row level security;
alter table appointments enable row level security;
alter table out_of_office enable row level security;
alter table promotions enable row level security;
alter table automation_log enable row level security;

-- Reference data: any signed-in staff member can read; only owners manage
create policy "read branches" on branches for select to authenticated using (true);
create policy "owners manage branches" on branches for all to authenticated using (my_role() = 'owner') with check (my_role() = 'owner');

create policy "read services" on services for select to authenticated using (true);
create policy "owners manage services" on services for all to authenticated using (my_role() = 'owner') with check (my_role() = 'owner');

create policy "read products" on products for select to authenticated using (true);
create policy "owners manage products" on products for all to authenticated using (my_role() = 'owner') with check (my_role() = 'owner');

-- Staff profiles
create policy "read staff" on staff_profiles for select to authenticated using (true);
create policy "owners insert staff" on staff_profiles for insert to authenticated with check (my_role() = 'owner');
create policy "owners update staff" on staff_profiles for update to authenticated using (my_role() = 'owner') with check (true);
create policy "claim my own invite" on staff_profiles for update to authenticated
  using (auth_user_id is null and status = 'invited')
  with check (auth_user_id = auth.uid());
create policy "owners delete staff" on staff_profiles for delete to authenticated using (my_role() = 'owner');

-- Clients: same branch, or owner (any branch)
create policy "branch read clients" on clients for select to authenticated
  using (my_role() = 'owner' or branch_id = my_branch());
create policy "branch write clients" on clients for insert to authenticated
  with check (my_role() = 'owner' or branch_id = my_branch());
create policy "branch update clients" on clients for update to authenticated
  using (my_role() = 'owner' or branch_id = my_branch());
create policy "branch delete clients" on clients for delete to authenticated
  using (my_role() = 'owner' or branch_id = my_branch());

-- Appointments: same branch to view/create; stylists edit only their own
create policy "branch read appts" on appointments for select to authenticated
  using (my_role() = 'owner' or branch_id = my_branch());
create policy "branch create appts" on appointments for insert to authenticated
  with check (my_role() = 'owner' or branch_id = my_branch());
create policy "branch update appts" on appointments for update to authenticated
  using (
    my_role() = 'owner'
    or (my_role() = 'receptionist' and branch_id = my_branch())
    or (my_role() = 'stylist' and branch_id = my_branch() and staff_id = my_staff_id())
  );
create policy "branch delete appts" on appointments for delete to authenticated
  using (
    my_role() = 'owner'
    or (my_role() = 'receptionist' and branch_id = my_branch())
    or (my_role() = 'stylist' and branch_id = my_branch() and staff_id = my_staff_id())
  );

-- Out of office: owners and receptionists manage, everyone reads
create policy "read ooo" on out_of_office for select to authenticated using (true);
create policy "manage ooo" on out_of_office for all to authenticated
  using (my_role() in ('owner','receptionist')) with check (my_role() in ('owner','receptionist'));

-- Promotions & automation log: owner only
create policy "owner read promotions" on promotions for select to authenticated using (my_role() = 'owner');
create policy "owner manage promotions" on promotions for all to authenticated using (my_role() = 'owner') with check (my_role() = 'owner');
create policy "owner read automation log" on automation_log for select to authenticated using (my_role() = 'owner');
create policy "insert automation log" on automation_log for insert to authenticated with check (true);

-- ---------- Starter data ----------

insert into branches (id, name, is_head) values
  ('00000000-0000-0000-0000-000000000001', 'Kingston', true),
  ('00000000-0000-0000-0000-000000000002', 'Portmore', false);

insert into services (name, price, duration, commissioned) values
  ('Wash & Style', 45, 45, true),
  ('Silk Press', 75, 90, true),
  ('Loc Retwist', 65, 75, true),
  ('Twist Out', 55, 60, true),
  ('Box Braids', 150, 240, true),
  ('Deep Conditioning Treatment', 40, 30, true),
  ('Natural Hair Cut', 35, 30, true),
  ('Consultation', 0, 15, false);

insert into products (name, price, beneficiary) values
  ('Natural Hair Oil', 18, 'salon'),
  ('Leave-In Cream', 22, 'staff'),
  ('Detangling Comb', 9, 'salon'),
  ('Sulfate-Free Shampoo', 24, 'staff');

-- Your first owner account — CHANGE THE EMAIL BELOW TO YOURS before running.
-- After this script runs, open the live app, click "Have an invite code?",
-- enter code WELCOME1, and finish setup with this email + a password you choose.
insert into staff_profiles (email, role, branch_id, pay_type, base_wage, status, invite_code)
values ('owner@example.com', 'owner', '00000000-0000-0000-0000-000000000001', 'fixed', 1400, 'invited', 'WELCOME1');
