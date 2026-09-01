import { supabase } from './supabaseClient';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const genCode = () => Array.from({ length: 6 }, () => '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 31)]).join('');

// ---------- mappers (database snake_case <-> app camelCase) ----------
const mapBranch = r => ({ id: r.id, name: r.name, isHead: r.is_head });
const mapStaff = r => ({ id: r.id, authUserId: r.auth_user_id, email: r.email, firstName: r.first_name, lastName: r.last_name, role: r.role, branchId: r.branch_id, payType: r.pay_type, baseWage: Number(r.base_wage), commissionRate: Number(r.commission_rate), status: r.status, inviteCode: r.invite_code });
const mapClient = r => ({ id: r.id, branchId: r.branch_id, firstName: r.first_name, lastName: r.last_name, nickname: r.nickname, phone: r.phone, birthday: r.birthday || '', email: r.email || '', notes: r.notes || '' });
const mapAppt = r => ({ id: r.id, branchId: r.branch_id, staffId: r.staff_id, clientId: r.client_id, serviceId: r.service_id, date: r.date, start: r.start_time, duration: r.duration, status: r.status, payments: r.payments || [], serviceAmount: Number(r.service_amount) || 0, products: r.products || [], productsTotal: Number(r.products_total) || 0, paidTotal: Number(r.paid_total) || 0, notes: r.notes || '' });
const mapOOO = r => ({ id: r.id, staffId: r.staff_id, startDate: r.start_date, endDate: r.end_date, reason: r.reason || '' });
const mapPromo = r => ({ id: r.id, name: r.name, subject: r.subject, body: r.body, trigger: r.trigger, active: r.active });
const mapLog = r => ({ id: r.id, promotionId: r.promotion_id, promotionName: r.promotion_name, clientId: r.client_id, clientEmail: r.client_email, sentAt: r.sent_at });

const check = ({ data, error }) => { if (error) throw error; return data; };

// ---------- fetchers ----------
export const fetchBranches = async () => check(await supabase.from('branches').select('*').order('is_head', { ascending: false })).map(mapBranch);
export const fetchServices = async () => check(await supabase.from('services').select('*').order('name'));
export const fetchProducts = async () => check(await supabase.from('products').select('*').order('name'));
export const fetchStaff = async () => check(await supabase.from('staff_profiles').select('*').order('created_at')).map(mapStaff);
export const fetchClients = async () => check(await supabase.from('clients').select('*').order('created_at', { ascending: false })).map(mapClient);
export const fetchAppointments = async () => check(await supabase.from('appointments').select('*').order('date', { ascending: false })).map(mapAppt);
export const fetchOOO = async () => check(await supabase.from('out_of_office').select('*')).map(mapOOO);
export const fetchPromotions = async () => check(await supabase.from('promotions').select('*').order('created_at', { ascending: false })).map(mapPromo);
export const fetchAutomationLog = async () => check(await supabase.from('automation_log').select('*').order('sent_at', { ascending: false }).limit(50)).map(mapLog);

// ---------- clients ----------
export const dbAddClient = async (c) => mapClient(check(await supabase.from('clients').insert({ branch_id: c.branchId, first_name: c.firstName || '', last_name: c.lastName || '', nickname: c.nickname, phone: c.phone, birthday: c.birthday || null, email: c.email || null, notes: c.notes || '' }).select().single()));
export const dbUpdateClient = async (id, c) => { check(await supabase.from('clients').update({ first_name: c.firstName || '', last_name: c.lastName || '', nickname: c.nickname, phone: c.phone, birthday: c.birthday || null, email: c.email || null, notes: c.notes || '' }).eq('id', id)); };
export const dbRemoveClient = async (id) => { check(await supabase.from('clients').delete().eq('id', id)); };

// ---------- appointments ----------
export const dbAddAppt = async (a) => { check(await supabase.from('appointments').insert({ branch_id: a.branchId, staff_id: a.staffId, client_id: a.clientId, service_id: a.serviceId, date: a.date, start_time: a.start, duration: a.duration, status: a.status || 'booked', payments: a.payments || [], service_amount: a.serviceAmount || 0, products: a.products || [], products_total: a.productsTotal || 0, paid_total: a.paidTotal || 0, notes: a.notes || '' })); };
export const dbUpdateAppt = async (id, patch) => {
  const p = {};
  if ('staffId' in patch) p.staff_id = patch.staffId;
  if ('clientId' in patch) p.client_id = patch.clientId;
  if ('serviceId' in patch) p.service_id = patch.serviceId;
  if ('date' in patch) p.date = patch.date;
  if ('start' in patch) p.start_time = patch.start;
  if ('duration' in patch) p.duration = patch.duration;
  if ('status' in patch) p.status = patch.status;
  if ('payments' in patch) p.payments = patch.payments;
  if ('serviceAmount' in patch) p.service_amount = patch.serviceAmount;
  if ('products' in patch) p.products = patch.products;
  if ('productsTotal' in patch) p.products_total = patch.productsTotal;
  if ('paidTotal' in patch) p.paid_total = patch.paidTotal;
  if ('notes' in patch) p.notes = patch.notes;
  check(await supabase.from('appointments').update(p).eq('id', id));
};
export const dbRemoveAppt = async (id) => { check(await supabase.from('appointments').delete().eq('id', id)); };

// ---------- out of office ----------
export const dbAddOOO = async (o) => { check(await supabase.from('out_of_office').insert({ staff_id: o.staffId, start_date: o.startDate, end_date: o.endDate, reason: o.reason || '' })); };
export const dbRemoveOOO = async (id) => { check(await supabase.from('out_of_office').delete().eq('id', id)); };

// ---------- staff ----------
export const dbInviteStaff = async (email, branchId) => {
  const code = genCode();
  check(await supabase.from('staff_profiles').insert({ email, role: 'stylist', branch_id: branchId, pay_type: 'commission_only', base_wage: 0, commission_rate: 0.35, status: 'invited', invite_code: code }));
  return code;
};
export const dbUpdateStaff = async (id, patch) => {
  const p = {};
  if ('role' in patch) p.role = patch.role;
  if ('branchId' in patch) p.branch_id = patch.branchId;
  if ('payType' in patch) p.pay_type = patch.payType;
  if ('baseWage' in patch) p.base_wage = patch.baseWage;
  if ('commissionRate' in patch) p.commission_rate = patch.commissionRate;
  check(await supabase.from('staff_profiles').update(p).eq('id', id));
};
export const dbRemoveStaff = async (id) => { check(await supabase.from('staff_profiles').delete().eq('id', id)); };

// ---------- services & products ----------
export const dbAddService = async (s) => { check(await supabase.from('services').insert(s)); };
export const dbUpdateService = async (id, s) => { check(await supabase.from('services').update(s).eq('id', id)); };
export const dbRemoveService = async (id) => { check(await supabase.from('services').delete().eq('id', id)); };
export const dbAddProduct = async (p) => { check(await supabase.from('products').insert(p)); };
export const dbUpdateProduct = async (id, p) => { check(await supabase.from('products').update(p).eq('id', id)); };
export const dbRemoveProduct = async (id) => { check(await supabase.from('products').delete().eq('id', id)); };

// ---------- promotions ----------
export const dbAddPromotion = async (p) => { check(await supabase.from('promotions').insert(p)); };
export const dbUpdatePromotion = async (id, p) => { check(await supabase.from('promotions').update(p).eq('id', id)); };
export const dbRemovePromotion = async (id) => { check(await supabase.from('promotions').delete().eq('id', id)); };
export const dbLogAutomation = async (entries) => {
  if (!entries || entries.length === 0) return;
  check(await supabase.from('automation_log').insert(entries.map(e => ({ promotion_id: e.promotionId, promotion_name: e.promotionName, client_id: e.clientId, client_email: e.clientEmail }))));
};

// ---------- auth ----------
export const dbSignIn = async (email, password) => { const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; };
export const dbSignOut = async () => { await supabase.auth.signOut(); };
export const dbGetMyProfile = async (authUserId) => {
  const row = check(await supabase.from('staff_profiles').select('*').eq('auth_user_id', authUserId).maybeSingle());
  return row ? mapStaff(row) : null;
};
export const dbAcceptInvite = async (code, firstName, lastName, password) => {
  const invited = check(await supabase.from('staff_profiles').select('*').eq('invite_code', code.trim().toUpperCase()).eq('status', 'invited').maybeSingle());
  if (!invited) throw new Error('That invite code is invalid or already used.');
  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email: invited.email, password });
  if (signUpErr) throw signUpErr;
  if (!signUpData.session) throw new Error('Account created — check your email to confirm it, then come back and sign in.');
  check(await supabase.from('staff_profiles').update({ auth_user_id: signUpData.user.id, first_name: firstName, last_name: lastName, status: 'active', invite_code: null }).eq('id', invited.id));
};
