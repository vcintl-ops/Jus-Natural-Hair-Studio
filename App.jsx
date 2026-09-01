import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Calendar, Users, UserCog, BarChart3, Plus, X,
  LogOut, ChevronLeft, ChevronRight, Trash2, Pencil, History, Copy,
  CheckCircle2, Truck, Ban, CreditCard, Banknote, Gift, SplitSquareHorizontal, ShieldAlert,
  Download, FileText, Mail
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';
import {
  uid, genCode,
  fetchBranches, fetchServices, fetchProducts, fetchStaff, fetchClients, fetchAppointments, fetchOOO, fetchPromotions, fetchAutomationLog,
  dbAddClient, dbUpdateClient, dbRemoveClient,
  dbAddAppt, dbUpdateAppt, dbRemoveAppt,
  dbAddOOO, dbRemoveOOO,
  dbInviteStaff, dbUpdateStaff, dbRemoveStaff,
  dbAddService, dbUpdateService, dbRemoveService,
  dbAddProduct, dbUpdateProduct, dbRemoveProduct,
  dbAddPromotion, dbUpdatePromotion, dbRemovePromotion, dbLogAutomation,
  dbSignIn, dbSignOut, dbGetMyProfile, dbAcceptInvite,
} from './db';

/* ----------------------------- constants ----------------------------- */
const DAY_START = 9 * 60;
const DAY_END = 20 * 60;
const PX_PER_MIN = 1.15;
const SLOT_MIN = 15;
const ANCHOR_FRIDAY = '2024-01-05'; // known Friday — biweekly payroll periods count forward/back from here

const INK = '#191420';
const PAPER = '#F8F6FB';
const CARD = '#FFFFFF';
const PRIMARY = '#4B2E83';
const PRIMARY_DARK = '#2E1B54';
const ACCENT = '#8B5CF6';
const MUTED = '#786F8A';
const BORDER = '#E3DDEC';
const DANGER = '#8A2A3B';
const LAVENDER = '#EDE7F6';

const STATUS_META = {
  booked: { label: 'Booked', bg: LAVENDER, fg: PRIMARY_DARK, border: '#D2C4EF' },
  confirmed: { label: 'Confirmed', bg: PRIMARY, fg: '#fff' },
  on_the_way: { label: 'On the way', bg: ACCENT, fg: '#fff' },
  completed: { label: 'Completed', bg: INK, fg: '#fff' },
  cancelled: { label: 'Cancelled', bg: '#D9D4E0', fg: '#655C74', strike: true },
  voided: { label: 'Voided', bg: '#F5E4E8', fg: DANGER, border: DANGER, strike: true },
};
const PAY_LABEL = { fixed: 'Fixed wage', commission_only: 'Commission only', base_plus_commission: 'Base + commission' };
const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'gift_card', label: 'Gift card', icon: Gift },
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const timeToMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minToTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fmtTime = (min) => { const h = Math.floor(min / 60), m = min % 60, p = h >= 12 ? 'PM' : 'AM'; let h12 = h % 12; if (h12 === 0) h12 = 12; return `${h12}:${String(m).padStart(2, '0')} ${p}`; };
const fmtDateLong = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtDateShort = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const money = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const staffName = (s) => s ? `${s.firstName || ''} ${s.lastName || ''}`.trim() || s.email : 'Unassigned';
const clientDisplayName = (c) => c ? (c.nickname ? c.nickname : `${c.firstName || ''} ${c.lastName || ''}`.trim()) : 'Client';
const clientFullName = (c) => c ? `${c.firstName || ''} ${c.lastName || ''}`.trim() : '';
const branchLabel = (b) => b ? `${b.name}${b.isHead ? ' (Head Branch)' : ''}` : '';

function getPayPeriod(dateISO) {
  const anchorMs = new Date(ANCHOR_FRIDAY + 'T00:00:00').getTime();
  const dateMs = new Date(dateISO + 'T00:00:00').getTime();
  const daysSince = Math.floor((dateMs - anchorMs) / 86400000);
  const periodIndex = Math.floor(daysSince / 14);
  const start = new Date(anchorMs + periodIndex * 14 * 86400000).toISOString().slice(0, 10);
  return { start, end: addDaysISO(start, 13) };
}

/* -------------------------------------------------------------------- */

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [profile, setProfile] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authScreen, setAuthScreen] = useState('login');
  const [ownerBranchId, setOwnerBranchId] = useState(null);
  const [view, setView] = useState('board');

  const [branches, setBranches] = useState([]);
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [clients, setClients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [outOfOffice, setOutOfOffice] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [automationLog, setAutomationLog] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const promotionsRef = useRef(promotions);
  useEffect(() => { promotionsRef.current = promotions; }, [promotions]);

  // ---------- auth bootstrap ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setProfile(null); setDataLoaded(false); return; }
    (async () => {
      try {
        const p = await dbGetMyProfile(session.user.id);
        setProfile(p);
        if (p && p.role === 'owner' && !ownerBranchId) setOwnerBranchId(p.branchId);
      } catch (e) {
        console.error('Failed to load your staff profile', e);
        setAuthError('Signed in, but could not load your staff profile. Check the browser console for details.');
      }
    })();
  }, [session]);

  // ---------- data loading ----------
  const refresh = {
    branches: async () => setBranches(await fetchBranches()),
    services: async () => setServices(await fetchServices()),
    products: async () => setProducts(await fetchProducts()),
    staff: async () => setStaff(await fetchStaff()),
    clients: async () => setClients(await fetchClients()),
    appointments: async () => setAppointments(await fetchAppointments()),
    outOfOffice: async () => setOutOfOffice(await fetchOOO()),
    promotions: async () => setPromotions(await fetchPromotions()),
    automationLog: async () => setAutomationLog(await fetchAutomationLog()),
  };

  useEffect(() => {
    if (!profile) return;
    (async () => {
      try {
        await Promise.all(Object.values(refresh).map(fn => fn()));
      } catch (e) {
        console.error('Failed to load salon data', e);
        setAuthError('Signed in, but could not load salon data. Check the browser console (F12) for details.');
      } finally {
        setDataLoaded(true);
      }
    })();
  }, [profile]);

  // ---------- realtime ----------
  useEffect(() => {
    if (!profile) return;
    const tables = ['branches', 'services', 'products', 'staff_profiles', 'clients', 'appointments', 'out_of_office', 'promotions', 'automation_log'];
    const keyFor = { branches: 'branches', services: 'services', products: 'products', staff_profiles: 'staff', clients: 'clients', appointments: 'appointments', out_of_office: 'outOfOffice', promotions: 'promotions', automation_log: 'automationLog' };
    const channel = supabase.channel('salon-live-changes');
    tables.forEach(t => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => refresh[keyFor[t]]());
    });
    channel.subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile]);

  const logout = async () => { await dbSignOut(); setView('board'); setAuthScreen('login'); };

  // ---------- data-changing actions (shared by every view) ----------
  const actions = {
    addAppt: (a) => dbAddAppt(a).then(refresh.appointments),
    updateAppt: (id, patch) => dbUpdateAppt(id, patch).then(refresh.appointments),
    removeAppt: (id) => dbRemoveAppt(id).then(refresh.appointments),
    addClient: async (c) => {
      const created = await dbAddClient(c);
      await refresh.clients();
      if (c.email) {
        const matches = promotionsRef.current.filter(p => p.active && p.trigger === 'new_client_email');
        if (matches.length) {
          await dbLogAutomation(matches.map(p => ({ promotionId: p.id, promotionName: p.name, clientId: created.id, clientEmail: c.email })));
          refresh.automationLog();
        }
      }
      return created;
    },
    updateClient: (id, c) => dbUpdateClient(id, c).then(refresh.clients),
    removeClient: (id) => dbRemoveClient(id).then(refresh.clients),
    addOOO: (o) => dbAddOOO(o).then(refresh.outOfOffice),
    removeOOO: (id) => dbRemoveOOO(id).then(refresh.outOfOffice),
    inviteStaff: async (email, branchId) => { const code = await dbInviteStaff(email, branchId); await refresh.staff(); return code; },
    updateStaff: (id, patch) => dbUpdateStaff(id, patch).then(refresh.staff),
    removeStaff: (id) => dbRemoveStaff(id).then(refresh.staff),
    addService: (s) => dbAddService(s).then(refresh.services),
    updateService: (id, s) => dbUpdateService(id, s).then(refresh.services),
    removeService: (id) => dbRemoveService(id).then(refresh.services),
    addProduct: (p) => dbAddProduct(p).then(refresh.products),
    updateProduct: (id, p) => dbUpdateProduct(id, p).then(refresh.products),
    removeProduct: (id) => dbRemoveProduct(id).then(refresh.products),
    addPromotion: (p) => dbAddPromotion(p).then(refresh.promotions),
    updatePromotion: (id, p) => dbUpdatePromotion(id, p).then(refresh.promotions),
    removePromotion: (id) => dbRemovePromotion(id).then(refresh.promotions),
    sendManualPromotion: async (promo) => {
      const targets = clients.filter(c => c.email);
      await dbLogAutomation(targets.map(c => ({ promotionId: promo.id, promotionName: promo.name, clientId: c.id, clientEmail: c.email })));
      refresh.automationLog();
    },
  };

  if (session === undefined) {
    return <Centered>Loading…</Centered>;
  }
  if (!session || !profile) {
    return (
      <AuthScreens
        screen={authScreen} setScreen={setAuthScreen}
        onLogin={async (email, password) => { try { await dbSignIn(email, password); return null; } catch (e) { return e.message || 'Sign-in failed.'; } }}
        onAcceptInvite={async (code, first, last, password) => { try { await dbAcceptInvite(code, first, last, password); return null; } catch (e) { return e.message || 'Could not set up your account.'; } }}
      />
    );
  }
  if (authError) return <Centered danger>{authError}</Centered>;
  if (!dataLoaded) return <Centered>Loading your salon's data…</Centered>;

  const currentUser = profile;
  const data = { branches, services, products, staff, clients, appointments, outOfOffice: outOfOffice, promotions, automationLog };
  const activeBranchId = currentUser.role === 'owner' ? (ownerBranchId || branches[0]?.id) : currentUser.branchId;
  const canSeeReports = currentUser.role === 'owner' || currentUser.role === 'receptionist';

  return (
    <div style={{ minHeight: '100vh', background: PAPER, fontFamily: '"Plus Jakarta Sans", -apple-system, sans-serif', color: INK, display: 'flex' }}>
      <style>{globalCss}</style>
      <Sidebar currentUser={currentUser} view={view} setView={setView} onLogout={logout}
        branches={branches} activeBranchId={activeBranchId} setActiveBranch={setOwnerBranchId} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {view === 'board' && <BoardView data={data} actions={actions} currentUser={currentUser} branchId={activeBranchId} />}
        {view === 'clients' && <ClientsView data={data} actions={actions} branchId={activeBranchId} />}
        {view === 'staff' && currentUser.role === 'owner' && <StaffView data={data} actions={actions} />}
        {view === 'reports' && canSeeReports && <ReportsView data={data} branches={branches} currentUser={currentUser} />}
        {view === 'promotions' && currentUser.role === 'owner' && <PromotionsView data={data} actions={actions} />}
      </div>
    </div>
  );
}

function Centered({ children, danger }) {
  return (
    <div style={{ minHeight: '100vh', background: PAPER, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Plus Jakarta Sans", sans-serif', padding: 24 }}>
      <style>{globalCss}</style>
      {danger
        ? <div style={{ maxWidth: 420, background: '#F5E4E8', border: `1px solid ${DANGER}`, borderRadius: 10, padding: 20, color: DANGER, fontSize: 14 }}>{children}</div>
        : <div style={{ color: MUTED }}>{children}</div>}
    </div>
  );
}

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; }
  button, input, select, textarea { font-family: inherit; transition: background-color .18s cubic-bezier(.4,0,.2,1), border-color .18s cubic-bezier(.4,0,.2,1), box-shadow .18s cubic-bezier(.4,0,.2,1), transform .14s cubic-bezier(.4,0,.2,1), color .18s ease, opacity .18s ease; }
  button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(25,20,32,0.12); }
  button:active:not(:disabled) { transform: translateY(0) scale(0.97); box-shadow: none; }
  .jn-card { transition: box-shadow .2s ease; }
  .jn-card:hover { box-shadow: 0 6px 22px rgba(25,20,32,0.07); }
  .jn-row:hover { background: #FAF8FC; }
  .jn-appt:hover { filter: brightness(1.07); transform: translateY(-1px) !important; box-shadow: 0 8px 16px rgba(0,0,0,0.22); }
  input:focus, select:focus, textarea:focus { outline: none; border-color: #8B5CF6 !important; box-shadow: 0 0 0 3px rgba(139,92,246,0.18); }
  @media screen { .print-area { display: none; } }
  @media print {
    body * { visibility: hidden; }
    .print-area, .print-area * { visibility: visible; }
    .print-area { position: absolute; top: 0; left: 0; width: 100%; padding: 24px; }
  }
`;

function Logo({ size = 34 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: PRIMARY, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ fontFamily: 'Fraunces, serif', color: '#fff', fontWeight: 600, fontSize: size * 0.5 }}>J</span>
    </div>
  );
}

/* ------------------------------ Auth screens ------------------------------ */
function AuthScreens({ screen, setScreen, onLogin, onAcceptInvite }) {
  return (
    <div style={{ minHeight: '100vh', background: INK, fontFamily: '"Plus Jakarta Sans", sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{globalCss}</style>
      <div style={{ width: 400, background: CARD, borderRadius: 18, padding: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <Logo />
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.2 }}>Jus Natural</div>
            <div style={{ fontSize: 12, color: MUTED, letterSpacing: 0.3 }}>Hair Studio · Staff</div>
          </div>
        </div>
        {screen === 'login' ? <LoginForm onLogin={onLogin} onSwitch={() => setScreen('invite')} /> : <InviteAcceptForm onAcceptInvite={onAcceptInvite} onSwitch={() => setScreen('login')} />}
      </div>
    </div>
  );
}

function LoginForm({ onLogin, onSwitch }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(''); setBusy(true);
    const err = await onLogin(email, password);
    setBusy(false);
    if (err) setError(err);
  };
  const onKeyDown = (e) => { if (e.key === 'Enter') submit(); };

  return (
    <div>
      <FieldRow label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={onKeyDown} style={inputStyle} placeholder="you@jusnatural.com" /></FieldRow>
      <FieldRow label="Password"><input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={onKeyDown} style={inputStyle} placeholder="••••••••" /></FieldRow>
      {error && <div style={{ color: DANGER, fontSize: 13, marginBottom: 12 }}>{error}</div>}
      <button type="button" onClick={submit} disabled={busy} style={{ ...primaryBtnStyle, width: '100%', justifyContent: 'center', padding: '10px 0', marginTop: 6 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <button type="button" onClick={onSwitch} style={{ background: 'none', border: 'none', color: PRIMARY, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Have an invite code? Set up your account</button>
      </div>
    </div>
  );
}

function InviteAcceptForm({ onAcceptInvite, onSwitch }) {
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError('');
    if (!code.trim() || !firstName.trim() || !lastName.trim() || !password) { setError('Fill in every field.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    const err = await onAcceptInvite(code, firstName, lastName, password);
    setBusy(false);
    if (err) setError(err);
  };
  const onKeyDown = (e) => { if (e.key === 'Enter') submit(); };

  return (
    <div>
      <FieldRow label="Invite code"><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} onKeyDown={onKeyDown} style={{ ...inputStyle, letterSpacing: 2, fontWeight: 600 }} placeholder="ABC123" /></FieldRow>
      <div style={{ display: 'flex', gap: 10 }}>
        <FieldRow label="First name" style={{ flex: 1 }}><input value={firstName} onChange={e => setFirstName(e.target.value)} onKeyDown={onKeyDown} style={inputStyle} /></FieldRow>
        <FieldRow label="Last name" style={{ flex: 1 }}><input value={lastName} onChange={e => setLastName(e.target.value)} onKeyDown={onKeyDown} style={inputStyle} /></FieldRow>
      </div>
      <FieldRow label="Create password"><input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={onKeyDown} style={inputStyle} /></FieldRow>
      <FieldRow label="Confirm password"><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={onKeyDown} style={inputStyle} /></FieldRow>
      {error && <div style={{ color: DANGER, fontSize: 13, marginBottom: 12 }}>{error}</div>}
      <button type="button" onClick={submit} disabled={busy} style={{ ...primaryBtnStyle, width: '100%', justifyContent: 'center', padding: '10px 0', marginTop: 6 }}>{busy ? 'Setting up…' : 'Set up my account'}</button>
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <button type="button" onClick={onSwitch} style={{ background: 'none', border: 'none', color: PRIMARY, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Back to sign in</button>
      </div>
    </div>
  );
}

/* ------------------------------ Sidebar ------------------------------ */
function Sidebar({ currentUser, view, setView, onLogout, branches, activeBranchId, setActiveBranch }) {
  const items = [
    { id: 'board', label: 'Appointments', icon: Calendar, show: true },
    { id: 'clients', label: 'Clients', icon: Users, show: true },
    { id: 'staff', label: 'Staff, Services & Products', icon: UserCog, show: currentUser.role === 'owner' },
    { id: 'reports', label: 'Reports', icon: BarChart3, show: currentUser.role === 'owner' || currentUser.role === 'receptionist' },
    { id: 'promotions', label: 'Promotions', icon: Mail, show: currentUser.role === 'owner' },
  ];
  return (
    <div style={{ width: 236, borderRight: `1px solid ${BORDER}`, background: CARD, display: 'flex', flexDirection: 'column', padding: '20px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px', marginBottom: 22 }}>
        <Logo size={28} />
        <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 16, lineHeight: 1.1, letterSpacing: -0.2 }}>Jus Natural</span>
      </div>

      {currentUser.role === 'owner' ? (
        <div style={{ marginBottom: 20, padding: '0 4px' }}>
          <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, marginBottom: 6 }}>Branch</div>
          <select value={activeBranchId || ''} onChange={e => setActiveBranch(e.target.value)} style={{ ...selectStyle, fontSize: 13 }}>
            {branches.map(b => <option key={b.id} value={b.id}>{branchLabel(b)}</option>)}
          </select>
        </div>
      ) : (
        <div style={{ marginBottom: 20, padding: '0 4px', fontSize: 12, color: MUTED }}>{branchLabel(branches.find(b => b.id === activeBranchId))}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.filter(i => i.show).map(i => {
          const Icon = i.icon; const active = view === i.id;
          return (
            <button key={i.id} onClick={() => setView(i.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 14, background: active ? LAVENDER : 'transparent', color: active ? PRIMARY_DARK : INK, fontWeight: active ? 600 : 400 }}>
              <Icon size={16} /> {i.label}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{staffName(currentUser)}</div>
        <div style={{ fontSize: 12, color: MUTED, textTransform: 'capitalize', marginBottom: 10 }}>{currentUser.role}</div>
        <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ Board (calendar) ------------------------------ */
function BoardView({ data, actions, currentUser, branchId }) {
  const [date, setDate] = useState(todayISO());
  const [modal, setModal] = useState(null);
  const [oooModalFor, setOooModalFor] = useState(null);
  const columnRefs = useRef({});
  const canManageOOO = currentUser.role === 'owner' || currentUser.role === 'receptionist';

  const stylists = data.staff.filter(s => s.role === 'stylist' && s.branchId === branchId && s.status === 'active');
  const appts = data.appointments.filter(a => a.branchId === branchId && a.date === date);
  const clientsInBranch = data.clients.filter(c => c.branchId === branchId);

  const isOOOToday = (staffId) => data.outOfOffice.some(o => o.staffId === staffId && date >= o.startDate && date <= o.endDate);
  const canEditAppt = (appt) => currentUser.role !== 'stylist' || appt.staffId === currentUser.id;

  const updateAppt = (id, patch) => actions.updateAppt(id, patch);
  const addAppt = (appt) => actions.addAppt({ branchId, ...appt });
  const removeAppt = (id) => actions.removeAppt(id);
  const addClient = (client) => actions.addClient({ branchId, ...client });
  const addOOO = (entry) => { actions.addOOO(entry); setOooModalFor(null); };
  const removeOOO = (id) => actions.removeOOO(id);

  const hourMarks = []; for (let m = DAY_START; m <= DAY_END; m += 60) hourMarks.push(m);
  const gridHeight = (DAY_END - DAY_START) * PX_PER_MIN;

  const timeFromDrop = (colId, clientY) => {
    const el = columnRefs.current[colId]; if (!el) return null;
    const rect = el.getBoundingClientRect();
    let min = DAY_START + (clientY - rect.top) / PX_PER_MIN;
    min = Math.round(min / SLOT_MIN) * SLOT_MIN;
    return Math.max(DAY_START, Math.min(DAY_END - SLOT_MIN, min));
  };

  const handleDrop = (e, stylistId) => {
    e.preventDefault();
    if (isOOOToday(stylistId)) return;
    const apptId = e.dataTransfer.getData('text/plain');
    const appt = appts.find(a => a.id === apptId);
    if (!appt || !canEditAppt(appt) || ['completed', 'voided', 'cancelled'].includes(appt.status)) return;
    const min = timeFromDrop(stylistId, e.clientY); if (min == null) return;
    updateAppt(apptId, { staffId: stylistId, start: minToTime(min) });
  };

  const handleColClick = (e, stylistId) => {
    if (e.target.closest('.appt-block') || e.target.closest('.ooo-btn')) return;
    if (isOOOToday(stylistId)) return;
    if (currentUser.role === 'stylist' && stylistId !== currentUser.id) return;
    const min = timeFromDrop(stylistId, e.clientY); if (min == null) return;
    setModal({ mode: 'new', staffId: stylistId, start: minToTime(min), date });
  };

  return (
    <div style={{ padding: '20px 28px', height: '100vh', overflow: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>{fmtDateLong(date)}</div>
          <div style={{ fontSize: 13, color: MUTED }}>{branchLabel(data.branches.find(b => b.id === branchId))}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setDate(addDaysISO(date, -1))} style={iconBtnStyle}><ChevronLeft size={16} /></button>
          <button onClick={() => setDate(todayISO())} style={{ ...ghostBtnStyle, padding: '7px 12px' }}>Today</button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '7px 8px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 13 }} />
          <button onClick={() => setDate(addDaysISO(date, 1))} style={iconBtnStyle}><ChevronRight size={16} /></button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_META).map(([k, m]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: MUTED }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.bg, border: `1px solid ${m.border || m.bg}`, display: 'inline-block' }} />
            {m.label}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: MUTED }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#DCD7E4', display: 'inline-block' }} /> Out of office
        </div>
      </div>

      {stylists.length === 0 ? (
        <EmptyState text="No stylists have accepted their invite for this branch yet." />
      ) : (
        <div style={{ display: 'flex', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', background: CARD }}>
          <div style={{ width: 56, flexShrink: 0, borderRight: `1px solid ${BORDER}` }}>
            <div style={{ height: 50, borderBottom: `1px solid ${BORDER}` }} />
            <div style={{ position: 'relative', height: gridHeight }}>
              {hourMarks.map(m => <div key={m} style={{ position: 'absolute', top: (m - DAY_START) * PX_PER_MIN - 6, right: 6, fontSize: 11, color: MUTED }}>{fmtTime(m).replace(':00', '')}</div>)}
            </div>
          </div>
          {stylists.map(st => {
            const ooo = isOOOToday(st.id);
            return (
              <div key={st.id} style={{ flex: 1, minWidth: 160, borderRight: `1px solid ${BORDER}` }}>
                <div style={{ height: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${BORDER}`, background: PAPER, position: 'relative' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{staffName(st)}</div>
                  {canManageOOO && (
                    <button className="ooo-btn" onClick={() => setOooModalFor(st)} title="Manage out-of-office"
                      style={{ position: 'absolute', right: 6, top: 6, background: 'none', border: 'none', cursor: 'pointer', color: ooo ? DANGER : MUTED, padding: 2, display: 'flex' }}>
                      <Ban size={13} />
                    </button>
                  )}
                </div>
                <div ref={el => columnRefs.current[st.id] = el} onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, st.id)} onClick={e => handleColClick(e, st.id)}
                  style={{ position: 'relative', height: gridHeight, cursor: ooo ? 'not-allowed' : 'copy', backgroundImage: `repeating-linear-gradient(to bottom, ${BORDER} 0, ${BORDER} 1px, transparent 1px, transparent ${60 * PX_PER_MIN}px)` }}>
                  {ooo && (
                    <>
                      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(45deg, rgba(120,111,138,0.07), rgba(120,111,138,0.07) 8px, rgba(120,111,138,0.13) 8px, rgba(120,111,138,0.13) 16px)', pointerEvents: 'none' }} />
                      <div style={{ position: 'absolute', top: 10, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: MUTED, fontWeight: 600, pointerEvents: 'none' }}>Out of office</div>
                    </>
                  )}
                  {appts.filter(a => a.staffId === st.id).map(a => {
                    const svc = data.services.find(s => s.id === a.serviceId);
                    const client = data.clients.find(c => c.id === a.clientId);
                    const startMin = timeToMin(a.start);
                    const top = (startMin - DAY_START) * PX_PER_MIN;
                    const height = Math.max(a.duration * PX_PER_MIN - 2, 18);
                    const editable = canEditAppt(a) && !['completed', 'voided', 'cancelled'].includes(a.status);
                    const meta = STATUS_META[a.status] || STATUS_META.booked;
                    return (
                      <div key={a.id} className="appt-block jn-appt" draggable={editable}
                        onDragStart={e => e.dataTransfer.setData('text/plain', a.id)}
                        onClick={e => { e.stopPropagation(); setModal({ mode: 'edit', appt: a }); }}
                        style={{ position: 'absolute', top, left: 4, right: 4, height, background: meta.bg, color: meta.fg, border: meta.border ? `1px solid ${meta.border}` : 'none', borderRadius: 6, padding: '4px 6px', fontSize: 11.5, lineHeight: 1.3, overflow: 'hidden', cursor: editable ? 'grab' : 'pointer', textDecoration: meta.strike ? 'line-through' : 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}
                        title={`${clientDisplayName(client)} · ${svc?.name || ''}`}>
                        <div style={{ fontWeight: 600 }}>{clientDisplayName(client)}</div>
                        <div style={{ opacity: 0.85 }}>{svc?.name} · {fmtTime(startMin)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <ApptModal modal={modal} data={data} branchId={branchId} stylists={stylists} clients={clientsInBranch}
          canDelete={modal.mode === 'edit' && canEditAppt(modal.appt) && modal.appt.status === 'booked'}
          onClose={() => setModal(null)}
          onSave={(payload) => { modal.mode === 'new' ? addAppt(payload) : updateAppt(modal.appt.id, payload); setModal(null); }}
          onDelete={() => { removeAppt(modal.appt.id); setModal(null); }}
          onQuickStatus={(status) => updateAppt(modal.appt.id, { status })}
          onCheckout={(payments, serviceAmount, products, paidTotal) => {
            updateAppt(modal.appt.id, { status: 'completed', payments, serviceAmount, products, productsTotal: products.reduce((s, p) => s + p.price * p.qty, 0), paidTotal });
            setModal(null);
          }}
          onVoid={() => { updateAppt(modal.appt.id, { status: 'voided' }); setModal(null); }}
          onAddClient={addClient}
        />
      )}
      {oooModalFor && <OOOModal staff={oooModalFor} list={data.outOfOffice} onAdd={addOOO} onRemove={removeOOO} onClose={() => setOooModalFor(null)} />}
    </div>
  );
}

function OOOModal({ staff, list, onAdd, onRemove, onClose }) {
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [reason, setReason] = useState('');
  const mine = list.filter(o => o.staffId === staff.id).sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <ModalShell onClose={onClose} title={`Out of office — ${staffName(staff)}`}>
      {mine.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {mine.map(o => (
            <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
              <span>{fmtDateShort(o.startDate)} – {fmtDateShort(o.endDate)}{o.reason ? ` · ${o.reason}` : ''}</span>
              <IconAction danger onClick={() => onRemove(o.id)}><Trash2 size={13} /></IconAction>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <FieldRow label="From" style={{ flex: 1 }}><input type="date" value={start} onChange={e => setStart(e.target.value)} style={inputStyle} /></FieldRow>
        <FieldRow label="To" style={{ flex: 1 }}><input type="date" value={end} onChange={e => setEnd(e.target.value)} style={inputStyle} /></FieldRow>
      </div>
      <FieldRow label="Reason (optional)"><input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} placeholder="Vacation, sick leave, etc." /></FieldRow>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Close</button>
        <button onClick={() => end >= start && onAdd({ id: uid(), staffId: staff.id, startDate: start, endDate: end, reason: reason.trim() })} style={primaryBtnStyle}>Add period</button>
      </div>
    </ModalShell>
  );
}

function ApptModal({ modal, data, branchId, stylists, clients, canDelete, onClose, onSave, onDelete, onQuickStatus, onCheckout, onVoid, onAddClient }) {
  const editing = modal.mode === 'edit';
  const appt = modal.appt;
  const seed = editing ? appt : { staffId: modal.staffId, date: modal.date, start: modal.start, clientId: clients[0]?.id || '', serviceId: data.services[0]?.id, duration: data.services[0]?.duration || 30 };
  const [staffId, setStaffId] = useState(seed.staffId);
  const [clientId, setClientId] = useState(seed.clientId);
  const [serviceId, setServiceId] = useState(seed.serviceId);
  const [date, setDate] = useState(seed.date);
  const [start, setStart] = useState(seed.start);
  const [duration, setDuration] = useState(seed.duration);
  const [newClientMode, setNewClientMode] = useState(false);
  const [newClient, setNewClient] = useState({ nickname: '', phone: '', firstName: '', lastName: '' });
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);

  const locked = editing && ['completed', 'voided', 'cancelled'].includes(appt.status);

  const handleServiceChange = (id) => {
    setServiceId(id);
    const svc = data.services.find(s => s.id === id);
    if (svc) setDuration(svc.duration);
  };

  const handleAddClient = async () => {
    if (!newClient.nickname.trim() || !newClient.phone.trim()) return;
    const c = await onAddClient({ firstName: newClient.firstName.trim(), lastName: newClient.lastName.trim(), nickname: newClient.nickname.trim(), phone: newClient.phone.trim(), birthday: '', email: '', notes: '' });
    setClientId(c.id); setNewClientMode(false); setNewClient({ nickname: '', phone: '', firstName: '', lastName: '' });
  };

  const save = () => { if (clientId) onSave({ staffId, clientId, serviceId, date, start, duration: Number(duration) }); };

  const svc = data.services.find(s => s.id === serviceId);

  if (checkoutOpen) {
    return <CheckoutModal serviceAmount={svc?.price || 0} products={data.products} onClose={() => setCheckoutOpen(false)} onComplete={(payments, serviceAmount, productLines, total) => onCheckout(payments, serviceAmount, productLines, total)} />;
  }

  return (
    <ModalShell onClose={onClose} title={editing ? 'Appointment' : 'New appointment'}>
      {editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: STATUS_META[appt.status].bg, color: STATUS_META[appt.status].fg, border: STATUS_META[appt.status].border ? `1px solid ${STATUS_META[appt.status].border}` : 'none', fontWeight: 600 }}>
            {STATUS_META[appt.status].label}
          </span>
        </div>
      )}

      <FieldRow label="Stylist"><select value={staffId} onChange={e => setStaffId(e.target.value)} style={selectStyle} disabled={locked}>{stylists.map(s => <option key={s.id} value={s.id}>{staffName(s)}</option>)}</select></FieldRow>

      <FieldRow label="Client">
        {!newClientMode ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ ...selectStyle, flex: 1 }} disabled={locked}>{clients.map(c => <option key={c.id} value={c.id}>{clientDisplayName(c)}{clientFullName(c) ? ` (${clientFullName(c)})` : ''}</option>)}</select>
            {!locked && <button onClick={() => setNewClientMode(true)} style={ghostBtnStyle}>+ New</button>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11.5, color: MUTED }}>Nickname and phone are required — no walk-in bookings without at least these two.</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input placeholder="Nickname *" value={newClient.nickname} onChange={e => setNewClient({ ...newClient, nickname: e.target.value })} style={inputStyle} />
              <input placeholder="Phone *" value={newClient.phone} onChange={e => setNewClient({ ...newClient, phone: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input placeholder="First name (optional)" value={newClient.firstName} onChange={e => setNewClient({ ...newClient, firstName: e.target.value })} style={inputStyle} />
              <input placeholder="Last name (optional)" value={newClient.lastName} onChange={e => setNewClient({ ...newClient, lastName: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleAddClient} disabled={!newClient.nickname.trim() || !newClient.phone.trim()} style={primaryBtnStyle}>Add client</button>
              <button onClick={() => setNewClientMode(false)} style={ghostBtnStyle}>Cancel</button>
            </div>
          </div>
        )}
      </FieldRow>

      <FieldRow label="Service">
        <select value={serviceId} onChange={e => handleServiceChange(e.target.value)} style={selectStyle} disabled={locked}>
          {data.services.map(s => <option key={s.id} value={s.id}>{s.name} — {money(s.price)}{!s.commissioned ? ' (non-commissioned)' : ''}</option>)}
        </select>
      </FieldRow>

      <div style={{ display: 'flex', gap: 12 }}>
        <FieldRow label="Date" style={{ flex: 1 }}><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} disabled={locked} /></FieldRow>
        <FieldRow label="Start time" style={{ flex: 1 }}><input type="time" value={start} onChange={e => setStart(e.target.value)} style={inputStyle} disabled={locked} /></FieldRow>
        <FieldRow label="Duration (min)" style={{ flex: 1 }}><input type="number" min={15} step={15} value={duration} onChange={e => setDuration(e.target.value)} style={inputStyle} disabled={locked} /></FieldRow>
      </div>

      {!locked && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 6 }}>
          {editing && appt.status === 'booked' && <ActionBtn icon={CheckCircle2} onClick={() => onQuickStatus('confirmed')}>Confirm</ActionBtn>}
          {editing && appt.status === 'confirmed' && <ActionBtn icon={Truck} onClick={() => onQuickStatus('on_the_way')}>On the way</ActionBtn>}
          {editing && <ActionBtn icon={CreditCard} onClick={() => setCheckoutOpen(true)}>Checkout</ActionBtn>}
          {editing && <ActionBtn icon={Ban} danger onClick={() => onQuickStatus('cancelled')}>Cancel appointment</ActionBtn>}
        </div>
      )}

      {editing && appt.status === 'cancelled' && <div style={{ marginBottom: 6 }}><ActionBtn icon={CheckCircle2} onClick={() => onQuickStatus('booked')}>Restore appointment</ActionBtn></div>}

      {editing && appt.status === 'completed' && (
        <div style={{ background: PAPER, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 6 }}>Payment</div>
          {appt.products && appt.products.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {appt.products.map((p, i) => <div key={i} style={{ fontSize: 12.5, display: 'flex', justifyContent: 'space-between', color: MUTED }}><span>{p.name} × {p.qty}</span><span>{money(p.price * p.qty)}</span></div>)}
            </div>
          )}
          {appt.payments.map((p, i) => (
            <div key={p.id || i} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ textTransform: 'capitalize' }}>{p.method.replace('_', ' ')}{p.last4 ? ` ····${p.last4}` : ''}{p.giftCardCode ? ` (${p.giftCardCode})` : ''}</span>
              <span>{money(p.amount)}</span>
            </div>
          ))}
          <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', justifyContent: 'space-between', marginTop: 6, borderTop: `1px solid ${BORDER}`, paddingTop: 6 }}>
            <span>Total paid</span><span>{money(appt.paidTotal)}</span>
          </div>
          {!confirmingVoid ? (
            <button onClick={() => setConfirmingVoid(true)} style={{ ...dangerGhostBtnStyle, marginTop: 10, fontSize: 12 }}><ShieldAlert size={13} /> Void payment</button>
          ) : (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: DANGER }}>Void this payment?</span>
              <button onClick={onVoid} style={{ ...dangerGhostBtnStyle, fontSize: 12 }}>Confirm void</button>
              <button onClick={() => setConfirmingVoid(false)} style={{ ...ghostBtnStyle, fontSize: 12, padding: '6px 10px' }}>Back</button>
            </div>
          )}
        </div>
      )}

      {editing && appt.status === 'voided' && <div style={{ fontSize: 13, color: DANGER, background: '#F5E4E8', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>Payment was voided for this appointment.</div>}

      {!locked && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
          <div>{canDelete && <button onClick={onDelete} style={dangerGhostBtnStyle}><Trash2 size={14} /> Delete</button>}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={ghostBtnStyle}>Close</button>
            <button onClick={save} style={primaryBtnStyle}>{editing ? 'Save changes' : 'Book appointment'}</button>
          </div>
        </div>
      )}
      {locked && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}><button onClick={onClose} style={ghostBtnStyle}>Close</button></div>}
    </ModalShell>
  );
}

function CheckoutModal({ serviceAmount, products, onClose, onComplete }) {
  const [productLines, setProductLines] = useState([]);
  const [pickProduct, setPickProduct] = useState(products[0]?.id || '');
  const [pickQty, setPickQty] = useState(1);
  const productsSubtotal = productLines.reduce((s, l) => s + l.price * l.qty, 0);
  const amountDue = serviceAmount + productsSubtotal;
  const [lines, setLines] = useState([{ id: uid(), method: 'cash', amount: serviceAmount, last4: '', giftCardCode: '' }]);

  const syncSingleLine = (newDue) => setLines(prev => prev.length === 1 ? [{ ...prev[0], amount: newDue }] : prev);

  const addProduct = () => {
    const prod = products.find(p => p.id === pickProduct); if (!prod) return;
    const newLines = [...productLines, { id: uid(), productId: prod.id, name: prod.name, price: prod.price, qty: Math.max(1, Number(pickQty) || 1), beneficiary: prod.beneficiary }];
    setProductLines(newLines);
    syncSingleLine(serviceAmount + newLines.reduce((s, l) => s + l.price * l.qty, 0));
  };
  const removeProduct = (id) => {
    const newLines = productLines.filter(l => l.id !== id);
    setProductLines(newLines);
    syncSingleLine(serviceAmount + newLines.reduce((s, l) => s + l.price * l.qty, 0));
  };

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const remaining = Math.round((amountDue - total) * 100) / 100;
  const updateLine = (id, patch) => setLines(lines.map(l => l.id === id ? { ...l, ...patch } : l));
  const addLine = () => setLines([...lines, { id: uid(), method: 'cash', amount: Math.max(remaining, 0), last4: '', giftCardCode: '' }]);
  const removeLine = (id) => setLines(lines.filter(l => l.id !== id));
  const linesValid = lines.every(l => Number(l.amount) > 0 && (l.method !== 'card' || /^\d{4}$/.test(l.last4)) && (l.method !== 'gift_card' || l.giftCardCode.trim().length > 0));
  const canComplete = linesValid && Math.abs(remaining) < 0.01;

  return (
    <ModalShell onClose={onClose} title="Checkout">
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 8 }}>Add a product (optional)</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={pickProduct} onChange={e => setPickProduct(e.target.value)} style={{ ...selectStyle, flex: 2 }}>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} — {money(p.price)}</option>)}
          </select>
          <input type="number" min={1} value={pickQty} onChange={e => setPickQty(e.target.value)} style={{ ...inputStyle, width: 60 }} />
          <button onClick={addProduct} style={ghostBtnStyle}>Add</button>
        </div>
        {productLines.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {productLines.map(l => (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
                <span>{l.name} × {l.qty}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{money(l.price * l.qty)} <IconAction danger onClick={() => removeProduct(l.id)}><X size={13} /></IconAction></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, padding: '10px 12px', background: PAPER, borderRadius: 10 }}>
        <span style={{ fontSize: 13, color: MUTED }}>Amount due (service {money(serviceAmount)} + products {money(productsSubtotal)})</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{money(amountDue)}</span>
      </div>

      {lines.map(l => (
        <div key={l.id} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select value={l.method} onChange={e => updateLine(l.id, { method: e.target.value })} style={{ ...selectStyle, flex: 1 }}>
              {PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <input type="number" step="0.01" value={l.amount} onChange={e => updateLine(l.id, { amount: e.target.value })} style={{ ...inputStyle, width: 100 }} />
            {lines.length > 1 && <button onClick={() => removeLine(l.id)} style={{ ...iconBtnStyle, color: DANGER }}><X size={14} /></button>}
          </div>
          {l.method === 'card' && <input placeholder="Last 4 digits" maxLength={4} value={l.last4} onChange={e => updateLine(l.id, { last4: e.target.value.replace(/\D/g, '').slice(0, 4) })} style={inputStyle} />}
          {l.method === 'gift_card' && <input placeholder="Gift card code" value={l.giftCardCode} onChange={e => updateLine(l.id, { giftCardCode: e.target.value })} style={inputStyle} />}
        </div>
      ))}

      <button onClick={addLine} style={{ ...ghostBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14 }}><SplitSquareHorizontal size={14} /> Split payment</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 16, color: Math.abs(remaining) < 0.01 ? MUTED : DANGER }}>
        <span>Remaining balance</span><span style={{ fontWeight: 600 }}>{money(remaining)}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button disabled={!canComplete} onClick={() => onComplete(lines.map(l => ({ id: l.id, method: l.method, amount: Number(l.amount), last4: l.method === 'card' ? l.last4 : undefined, giftCardCode: l.method === 'gift_card' ? l.giftCardCode : undefined })), serviceAmount, productLines, total)}
          style={{ ...primaryBtnStyle, opacity: canComplete ? 1 : 0.5, cursor: canComplete ? 'pointer' : 'not-allowed' }}>Complete checkout</button>
      </div>
    </ModalShell>
  );
}

function ActionBtn({ icon: Icon, children, onClick, danger }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1px solid ${danger ? DANGER : BORDER}`, background: CARD, color: danger ? DANGER : INK, fontSize: 12.5, cursor: 'pointer' }}>
      <Icon size={13} /> {children}
    </button>
  );
}

/* ------------------------------ Clients ------------------------------ */
function ClientsView({ data, actions, branchId }) {
  const [modal, setModal] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const clients = data.clients.filter(c => c.branchId === branchId);

  const save = async (payload) => {
    if (modal.mode === 'new') await actions.addClient({ branchId, ...payload });
    else await actions.updateClient(modal.client.id, payload);
    setModal(null);
  };
  const remove = (id) => actions.removeClient(id);

  return (
    <div style={{ padding: '20px 28px', height: '100vh', overflow: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>Clients</div>
        <button onClick={() => setModal({ mode: 'new' })} style={primaryBtnStyle}><Plus size={14} /> Add client</button>
      </div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>Nickname and phone are required for every client — no anonymous walk-in records. Adding an email unlocks promotions for them.</div>

      {clients.length === 0 ? <EmptyState text="No clients yet for this branch." /> : (
        <div className="jn-card" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          <TableHeader cols={['Name', 'Contact', 'Birthday', 'Notes', '']} />
          {clients.map(c => (
            <div key={c.id} className="jn-row" style={rowStyle}>
              <div style={{ flex: 1.3 }}>
                <div style={{ fontWeight: 600 }}>{clientDisplayName(c)}</div>
                {clientFullName(c) && <div style={{ fontSize: 11.5, color: MUTED }}>{clientFullName(c)}</div>}
              </div>
              <div style={{ flex: 1.4, color: MUTED, fontSize: 12.5 }}>
                <div>{c.phone}</div>
                {c.email ? <div>{c.email}</div> : <div style={{ color: ACCENT, fontStyle: 'italic' }}>Add email for promotions</div>}
              </div>
              <div style={{ flex: 0.9, color: MUTED }}>{c.birthday ? fmtDateShort(c.birthday) : '—'}</div>
              <div style={{ flex: 1.5, color: MUTED, fontSize: 13 }}>{c.notes || '—'}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <IconAction onClick={() => setHistoryFor(c)}><History size={14} /></IconAction>
                <IconAction onClick={() => setModal({ mode: 'edit', client: c })}><Pencil size={14} /></IconAction>
                <IconAction danger onClick={() => remove(c.id)}><Trash2 size={14} /></IconAction>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && <ClientModal modal={modal} onClose={() => setModal(null)} onSave={save} />}
      {historyFor && <ClientHistoryModal client={historyFor} data={data} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function ClientModal({ modal, onClose, onSave }) {
  const seed = modal.mode === 'edit' ? modal.client : { firstName: '', lastName: '', nickname: '', birthday: '', email: '', phone: '', notes: '' };
  const [form, setForm] = useState(seed);
  const set = (k, v) => setForm({ ...form, [k]: v });
  const valid = form.nickname.trim() && form.phone.trim();
  return (
    <ModalShell onClose={onClose} title={modal.mode === 'new' ? 'Add client' : 'Edit client'}>
      <FieldRow label="Nickname / alias *"><input value={form.nickname} onChange={e => set('nickname', e.target.value)} style={inputStyle} /></FieldRow>
      <FieldRow label="Phone *"><input value={form.phone} onChange={e => set('phone', e.target.value)} style={inputStyle} /></FieldRow>
      <div style={{ display: 'flex', gap: 12 }}>
        <FieldRow label="First name" style={{ flex: 1 }}><input value={form.firstName} onChange={e => set('firstName', e.target.value)} style={inputStyle} /></FieldRow>
        <FieldRow label="Last name" style={{ flex: 1 }}><input value={form.lastName} onChange={e => set('lastName', e.target.value)} style={inputStyle} /></FieldRow>
      </div>
      <FieldRow label="Birthday"><input type="date" value={form.birthday} onChange={e => set('birthday', e.target.value)} style={inputStyle} /></FieldRow>
      <FieldRow label={<span>Email <span style={{ color: ACCENT, fontWeight: 600 }}>— unlocks promotions</span></span>}><input type="email" value={form.email} onChange={e => set('email', e.target.value)} style={inputStyle} /></FieldRow>
      <FieldRow label="Notes"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} /></FieldRow>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button onClick={() => valid && onSave(form)} disabled={!valid} style={{ ...primaryBtnStyle, opacity: valid ? 1 : 0.5 }}>Save</button>
      </div>
    </ModalShell>
  );
}

function ClientHistoryModal({ client, data, onClose }) {
  const history = data.appointments.filter(a => a.clientId === client.id).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  return (
    <ModalShell onClose={onClose} title={`${clientDisplayName(client)} — appointment history`}>
      {history.length === 0 ? <EmptyState text="No appointments recorded yet." /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflow: 'auto' }}>
          {history.map(a => {
            const svc = data.services.find(s => s.id === a.serviceId);
            const st = data.staff.find(s => s.id === a.staffId);
            const meta = STATUS_META[a.status];
            return (
              <div key={a.id} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{fmtDateShort(a.date)} · {fmtTime(timeToMin(a.start))}</span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: meta.bg, color: meta.fg }}>{meta.label}</span>
                </div>
                <div style={{ fontSize: 13, color: MUTED }}>{svc?.name} with {staffName(st)}</div>
                {a.products && a.products.length > 0 && <div style={{ fontSize: 12.5, color: MUTED }}>Products: {a.products.map(p => `${p.name} ×${p.qty}`).join(', ')}</div>}
                {a.status === 'completed' && <div style={{ fontSize: 13, marginTop: 4 }}>Paid {money(a.paidTotal)} — {a.payments.map(p => p.method.replace('_', ' ')).join(', ')}</div>}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button onClick={onClose} style={ghostBtnStyle}>Close</button></div>
    </ModalShell>
  );
}

/* ------------------------------ Staff, Services & Products (owner) ------------------------------ */
function StaffView({ data, actions }) {
  const [tab, setTab] = useState('staff');
  const [staffModal, setStaffModal] = useState(null);
  const [svcModal, setSvcModal] = useState(null);
  const [prodModal, setProdModal] = useState(null);
  const [inviteModal, setInviteModal] = useState(null);

  const saveStaff = async (payload) => { await actions.updateStaff(staffModal.staff.id, payload); setStaffModal(null); };
  const removeStaff = (id) => actions.removeStaff(id);
  const createInvite = (email, branchId) => actions.inviteStaff(email, branchId);
  const saveService = async (payload) => { if (svcModal.mode === 'new') await actions.addService(payload); else await actions.updateService(svcModal.service.id, payload); setSvcModal(null); };
  const removeService = (id) => actions.removeService(id);
  const saveProduct = async (payload) => { if (prodModal.mode === 'new') await actions.addProduct(payload); else await actions.updateProduct(prodModal.product.id, payload); setProdModal(null); };
  const removeProduct = (id) => actions.removeProduct(id);

  return (
    <div style={{ padding: '20px 28px', height: '100vh', overflow: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>Staff, Services &amp; Products</div>
        <button onClick={() => tab === 'staff' ? setInviteModal({}) : tab === 'services' ? setSvcModal({ mode: 'new' }) : setProdModal({ mode: 'new' })} style={primaryBtnStyle}>
          <Plus size={14} /> {tab === 'staff' ? 'Invite staff' : tab === 'services' ? 'Add service' : 'Add product'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {['staff', 'services', 'products'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${tab === t ? PRIMARY : BORDER}`, background: tab === t ? PRIMARY : CARD, color: tab === t ? '#fff' : INK, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {tab === 'staff' && (
        <div className="jn-card" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          <TableHeader cols={['Name', 'Role', 'Branch', 'Pay type', 'Base wage', 'Commission', '']} />
          {data.staff.map(s => (
            <div key={s.id} className="jn-row" style={rowStyle}>
              <div style={{ flex: 1.2, fontWeight: 600 }}>{s.status === 'invited' ? <span style={{ color: MUTED, fontStyle: 'italic' }}>{s.email}</span> : staffName(s)}</div>
              <div style={{ flex: 1, color: MUTED, textTransform: 'capitalize' }}>{s.role}</div>
              <div style={{ flex: 1, color: MUTED }}>{branchLabel(data.branches.find(b => b.id === s.branchId))}</div>
              {s.status === 'invited' ? (
                <div style={{ flex: 2.4, color: MUTED, fontSize: 12.5 }}>Invited — code <strong style={{ letterSpacing: 1, color: PRIMARY }}>{s.inviteCode}</strong></div>
              ) : (
                <>
                  <div style={{ flex: 1.2, color: MUTED }}>{PAY_LABEL[s.payType]}</div>
                  <div style={{ flex: 1, color: MUTED }}>{s.baseWage ? money(s.baseWage) + '/period' : '—'}</div>
                  <div style={{ flex: 1, color: MUTED }}>{s.commissionRate ? `${Math.round(s.commissionRate * 100)}%` : '—'}</div>
                </>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                {s.status === 'active' && <IconAction onClick={() => setStaffModal({ staff: s })}><Pencil size={14} /></IconAction>}
                {s.role !== 'owner' && <IconAction danger onClick={() => removeStaff(s.id)}><Trash2 size={14} /></IconAction>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'services' && (
        <div className="jn-card" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          <TableHeader cols={['Service', 'Price', 'Duration', 'Category', '']} />
          {data.services.map(s => (
            <div key={s.id} className="jn-row" style={rowStyle}>
              <div style={{ flex: 2, fontWeight: 600 }}>{s.name}</div>
              <div style={{ flex: 1, color: MUTED }}>{money(s.price)}</div>
              <div style={{ flex: 1, color: MUTED }}>{s.duration} min</div>
              <div style={{ flex: 1.2 }}>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: s.commissioned ? LAVENDER : '#EFEDF2', color: s.commissioned ? PRIMARY_DARK : MUTED, fontWeight: 600 }}>{s.commissioned ? 'Commissioned' : 'Non-commissioned'}</span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <IconAction onClick={() => setSvcModal({ mode: 'edit', service: s })}><Pencil size={14} /></IconAction>
                <IconAction danger onClick={() => removeService(s.id)}><Trash2 size={14} /></IconAction>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'products' && (
        <div className="jn-card" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          <TableHeader cols={['Product', 'Price', 'Sale benefits', '']} />
          {data.products.map(p => (
            <div key={p.id} className="jn-row" style={rowStyle}>
              <div style={{ flex: 2, fontWeight: 600 }}>{p.name}</div>
              <div style={{ flex: 1, color: MUTED }}>{money(p.price)}</div>
              <div style={{ flex: 1.2 }}>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: p.beneficiary === 'staff' ? LAVENDER : '#EFEDF2', color: p.beneficiary === 'staff' ? PRIMARY_DARK : MUTED, fontWeight: 600, textTransform: 'capitalize' }}>{p.beneficiary === 'staff' ? 'Selling stylist' : 'Salon'}</span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <IconAction onClick={() => setProdModal({ mode: 'edit', product: p })}><Pencil size={14} /></IconAction>
                <IconAction danger onClick={() => removeProduct(p.id)}><Trash2 size={14} /></IconAction>
              </div>
            </div>
          ))}
        </div>
      )}

      {staffModal && <StaffModal modal={staffModal} branches={data.branches} onClose={() => setStaffModal(null)} onSave={saveStaff} />}
      {svcModal && <ServiceModal modal={svcModal} onClose={() => setSvcModal(null)} onSave={saveService} />}
      {prodModal && <ProductModal modal={prodModal} onClose={() => setProdModal(null)} onSave={saveProduct} />}
      {inviteModal && <InviteModal branches={data.branches} onClose={() => setInviteModal(null)} onCreate={createInvite} />}
    </div>
  );
}

function InviteModal({ branches, onClose, onCreate }) {
  const [email, setEmail] = useState('');
  const [branchId, setBranchId] = useState(branches[0].id);
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => { if (!email.trim()) return; setBusy(true); const c = await onCreate(email, branchId); setBusy(false); setCode(c); };
  const copy = () => { try { navigator.clipboard.writeText(code); } catch (e) {} };
  return (
    <ModalShell onClose={onClose} title="Invite staff member">
      {!code ? (
        <>
          <FieldRow label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} placeholder="name@jusnatural.com" /></FieldRow>
          <FieldRow label="Branch"><select value={branchId} onChange={e => setBranchId(e.target.value)} style={selectStyle}>{branches.map(b => <option key={b.id} value={b.id}>{branchLabel(b)}</option>)}</select></FieldRow>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>New staff start with stylist-level access. You can raise their role afterward.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
            <button onClick={submit} disabled={busy} style={primaryBtnStyle}>{busy ? 'Creating…' : 'Create invite'}</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>Share this code with {email} — they'll enter it at "Have an invite code?" on the sign-in screen.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: PAPER, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
            <span style={{ fontFamily: 'Fraunces, serif', fontSize: 24, letterSpacing: 4, fontWeight: 600, flex: 1 }}>{code}</span>
            <button onClick={copy} style={ghostBtnStyle}><Copy size={14} /></button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button onClick={onClose} style={primaryBtnStyle}>Done</button></div>
        </>
      )}
    </ModalShell>
  );
}

function StaffModal({ modal, branches, onClose, onSave }) {
  const seed = modal.staff;
  const [role, setRole] = useState(seed.role);
  const [branchId, setBranchId] = useState(seed.branchId);
  const [payType, setPayType] = useState(seed.payType);
  const [baseWage, setBaseWage] = useState(seed.baseWage);
  const [commissionRate, setCommissionRate] = useState(Math.round(seed.commissionRate * 100));
  return (
    <ModalShell onClose={onClose} title={`Edit ${staffName(seed)}`}>
      <div style={{ display: 'flex', gap: 12 }}>
        <FieldRow label="Role" style={{ flex: 1 }}>
          <select value={role} onChange={e => setRole(e.target.value)} style={selectStyle} disabled={seed.role === 'owner'}>
            <option value="stylist">Stylist</option><option value="receptionist">Receptionist</option><option value="owner">Owner</option>
          </select>
        </FieldRow>
        <FieldRow label="Branch" style={{ flex: 1 }}><select value={branchId} onChange={e => setBranchId(e.target.value)} style={selectStyle}>{branches.map(b => <option key={b.id} value={b.id}>{branchLabel(b)}</option>)}</select></FieldRow>
      </div>
      <FieldRow label="Pay type">
        <select value={payType} onChange={e => setPayType(e.target.value)} style={selectStyle}>
          <option value="fixed">Fixed wage</option><option value="commission_only">Commission only</option><option value="base_plus_commission">Base + commission</option>
        </select>
      </FieldRow>
      <div style={{ display: 'flex', gap: 12 }}>
        {payType !== 'commission_only' && <FieldRow label="Base wage (per pay period)" style={{ flex: 1 }}><input type="number" value={baseWage} onChange={e => setBaseWage(e.target.value)} style={inputStyle} /></FieldRow>}
        {payType !== 'fixed' && <FieldRow label="Commission rate (%)" style={{ flex: 1 }}><input type="number" value={commissionRate} onChange={e => setCommissionRate(e.target.value)} style={inputStyle} /></FieldRow>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button onClick={() => onSave({ role, branchId, payType, baseWage: payType === 'commission_only' ? 0 : Number(baseWage) || 0, commissionRate: payType === 'fixed' ? 0 : Number(commissionRate) / 100 })} style={primaryBtnStyle}>Save</button>
      </div>
    </ModalShell>
  );
}

function ServiceModal({ modal, onClose, onSave }) {
  const seed = modal.mode === 'edit' ? modal.service : { name: '', price: 50, duration: 30, commissioned: true };
  const [name, setName] = useState(seed.name);
  const [price, setPrice] = useState(seed.price);
  const [duration, setDuration] = useState(seed.duration);
  const [commissioned, setCommissioned] = useState(seed.commissioned);
  return (
    <ModalShell onClose={onClose} title={modal.mode === 'new' ? 'Add service' : 'Edit service'}>
      <FieldRow label="Service name"><input value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></FieldRow>
      <div style={{ display: 'flex', gap: 12 }}>
        <FieldRow label="Price ($)" style={{ flex: 1 }}><input type="number" value={price} onChange={e => setPrice(e.target.value)} style={inputStyle} /></FieldRow>
        <FieldRow label="Duration (min)" style={{ flex: 1 }}><input type="number" step={15} value={duration} onChange={e => setDuration(e.target.value)} style={inputStyle} /></FieldRow>
      </div>
      <FieldRow label="Category">
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setCommissioned(true)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${commissioned ? PRIMARY : BORDER}`, background: commissioned ? PRIMARY : CARD, color: commissioned ? '#fff' : INK, fontSize: 13, cursor: 'pointer' }}>Commissioned</button>
          <button type="button" onClick={() => setCommissioned(false)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${!commissioned ? PRIMARY : BORDER}`, background: !commissioned ? PRIMARY : CARD, color: !commissioned ? '#fff' : INK, fontSize: 13, cursor: 'pointer' }}>Non-commissioned</button>
        </div>
      </FieldRow>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button onClick={() => name.trim() && onSave({ name: name.trim(), price: Number(price), duration: Number(duration), commissioned })} style={primaryBtnStyle}>Save</button>
      </div>
    </ModalShell>
  );
}

function ProductModal({ modal, onClose, onSave }) {
  const seed = modal.mode === 'edit' ? modal.product : { name: '', price: 20, beneficiary: 'salon' };
  const [name, setName] = useState(seed.name);
  const [price, setPrice] = useState(seed.price);
  const [beneficiary, setBeneficiary] = useState(seed.beneficiary);
  return (
    <ModalShell onClose={onClose} title={modal.mode === 'new' ? 'Add product' : 'Edit product'}>
      <FieldRow label="Product name"><input value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></FieldRow>
      <FieldRow label="Price ($)"><input type="number" value={price} onChange={e => setPrice(e.target.value)} style={inputStyle} /></FieldRow>
      <FieldRow label="Sale benefits">
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setBeneficiary('salon')} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${beneficiary === 'salon' ? PRIMARY : BORDER}`, background: beneficiary === 'salon' ? PRIMARY : CARD, color: beneficiary === 'salon' ? '#fff' : INK, fontSize: 13, cursor: 'pointer' }}>Salon</button>
          <button type="button" onClick={() => setBeneficiary('staff')} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${beneficiary === 'staff' ? PRIMARY : BORDER}`, background: beneficiary === 'staff' ? PRIMARY : CARD, color: beneficiary === 'staff' ? '#fff' : INK, fontSize: 13, cursor: 'pointer' }}>Selling stylist</button>
        </div>
      </FieldRow>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button onClick={() => name.trim() && onSave({ name: name.trim(), price: Number(price), beneficiary })} style={primaryBtnStyle}>Save</button>
      </div>
    </ModalShell>
  );
}

/* ------------------------------ Promotions (owner) ------------------------------ */
function PromotionsView({ data, actions }) {
  const [modal, setModal] = useState(null);
  const save = async (payload) => { if (modal.mode === 'new') await actions.addPromotion(payload); else await actions.updatePromotion(modal.promo.id, payload); setModal(null); };
  const remove = (id) => actions.removePromotion(id);
  const toggleActive = (p) => actions.updatePromotion(p.id, { active: !p.active });
  const sendManualNow = (p) => actions.sendManualPromotion(p);

  const log = [...data.automationLog].sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt)).slice(0, 30);

  return (
    <div style={{ padding: '20px 28px', height: '100vh', overflow: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>Promotions</div>
        <button onClick={() => setModal({ mode: 'new' })} style={primaryBtnStyle}><Plus size={14} /> New promotion</button>
      </div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 20, maxWidth: 640 }}>
        Sends here are logged in the database but not yet delivered as real email — that's the next piece to wire up.
      </div>

      <div className="jn-card" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', marginBottom: 24 }}>
        <TableHeader cols={['Promotion', 'Trigger', 'Status', '']} />
        {data.promotions.map(p => (
          <div key={p.id} className="jn-row" style={rowStyle}>
            <div style={{ flex: 2 }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: MUTED }}>{p.subject}</div>
            </div>
            <div style={{ flex: 1.4, color: MUTED, fontSize: 13 }}>{p.trigger === 'new_client_email' ? 'On new client (with email)' : 'Manual send'}</div>
            <div style={{ flex: 1 }}>
              <button onClick={() => toggleActive(p)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer', background: p.active ? LAVENDER : '#EFEDF2', color: p.active ? PRIMARY_DARK : MUTED, fontWeight: 600 }}>{p.active ? 'Active' : 'Inactive'}</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {p.trigger === 'manual' && p.active && <IconAction onClick={() => sendManualNow(p)}><Mail size={14} /></IconAction>}
              <IconAction onClick={() => setModal({ mode: 'edit', promo: p })}><Pencil size={14} /></IconAction>
              <IconAction danger onClick={() => remove(p.id)}><Trash2 size={14} /></IconAction>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Automation log</div>
      {log.length === 0 ? <EmptyState text="No simulated sends yet." /> : (
        <div className="jn-card" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          <TableHeader cols={['Promotion', 'Client email', 'Sent (simulated)']} />
          {log.map(l => (
            <div key={l.id} className="jn-row" style={rowStyle}>
              <div style={{ flex: 1.5, fontWeight: 600 }}>{l.promotionName}</div>
              <div style={{ flex: 1.5, color: MUTED }}>{l.clientEmail}</div>
              <div style={{ flex: 1, color: MUTED }}>{new Date(l.sentAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {modal && <PromotionModal modal={modal} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

function PromotionModal({ modal, onClose, onSave }) {
  const seed = modal.mode === 'edit' ? modal.promo : { name: '', subject: '', body: '', trigger: 'new_client_email', active: false };
  const [name, setName] = useState(seed.name);
  const [subject, setSubject] = useState(seed.subject);
  const [body, setBody] = useState(seed.body);
  const [trigger, setTrigger] = useState(seed.trigger);
  return (
    <ModalShell onClose={onClose} title={modal.mode === 'new' ? 'New promotion' : 'Edit promotion'}>
      <FieldRow label="Internal name"><input value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></FieldRow>
      <FieldRow label="Email subject"><input value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} /></FieldRow>
      <FieldRow label="Email copy"><textarea value={body} onChange={e => setBody(e.target.value)} style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} /></FieldRow>
      <FieldRow label="Trigger">
        <select value={trigger} onChange={e => setTrigger(e.target.value)} style={selectStyle}>
          <option value="new_client_email">Automatically — when a new client registers with an email</option>
          <option value="manual">Manually — I'll trigger it myself</option>
        </select>
      </FieldRow>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button onClick={() => name.trim() && onSave({ name: name.trim(), subject: subject.trim(), body, trigger, active: seed.active || false })} style={primaryBtnStyle}>Save</button>
      </div>
    </ModalShell>
  );
}

/* ------------------------------ Reports ------------------------------ */
function ReportsView({ data, branches, currentUser }) {
  const canExport = currentUser.role === 'owner';
  const lockedBranch = currentUser.role !== 'owner' ? currentUser.branchId : null;
  const [from, setFrom] = useState(addDaysISO(todayISO(), -6));
  const [to, setTo] = useState(todayISO());
  const [branchFilter, setBranchFilter] = useState(lockedBranch || 'all');
  const [payPeriodStart, setPayPeriodStart] = useState(getPayPeriod(todayISO()).start);
  const [printPayload, setPrintPayload] = useState(null);

  const effectiveBranch = lockedBranch || branchFilter;
  const payPeriod = { start: payPeriodStart, end: addDaysISO(payPeriodStart, 13) };

  useEffect(() => {
    if (!printPayload) return;
    const t = setTimeout(() => window.print(), 60);
    const onAfter = () => setPrintPayload(null);
    window.addEventListener('afterprint', onAfter);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', onAfter); };
  }, [printPayload]);

  const completed = data.appointments.filter(a => a.status === 'completed' && a.date >= from && a.date <= to && (effectiveBranch === 'all' || a.branchId === effectiveBranch));
  const totalRevenue = completed.reduce((sum, a) => sum + (a.paidTotal || 0), 0);

  const byMethod = useMemo(() => {
    const m = {};
    completed.forEach(a => a.payments.forEach(p => { m[p.method] = (m[p.method] || 0) + p.amount; }));
    return m;
  }, [completed]);

  const byStaffChart = useMemo(() => {
    const m = {};
    completed.forEach(a => { const st = data.staff.find(s => s.id === a.staffId); if (!st) return; const key = st.firstName || st.email; m[key] = (m[key] || 0) + (a.paidTotal || 0); });
    return Object.entries(m).map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue);
  }, [completed, data.staff]);

  const periodAppts = data.appointments.filter(a => a.status === 'completed' && a.date >= payPeriod.start && a.date <= payPeriod.end && (effectiveBranch === 'all' || a.branchId === effectiveBranch));
  const relevantStaff = data.staff.filter(s => s.status === 'active' && (effectiveBranch === 'all' || s.branchId === effectiveBranch));
  const payrollRows = relevantStaff.map(s => {
    const own = periodAppts.filter(a => a.staffId === s.id);
    const commissionableRevenue = own.reduce((sum, a) => { const svc = data.services.find(sv => sv.id === a.serviceId); return sum + (svc && svc.commissioned ? (a.serviceAmount ?? 0) : 0); }, 0);
    const productRevenue = own.reduce((sum, a) => sum + (a.products || []).filter(p => p.beneficiary === 'staff').reduce((s2, p) => s2 + p.price * p.qty, 0), 0);
    const commission = s.payType === 'fixed' ? 0 : commissionableRevenue * s.commissionRate;
    const base = s.payType === 'commission_only' ? 0 : s.baseWage;
    return { ...s, jobs: own.length, commissionableRevenue, productRevenue, commission, base, total: commission + base + productRevenue };
  });

  const voidedCount = data.appointments.filter(a => a.status === 'voided' && a.date >= from && a.date <= to && (effectiveBranch === 'all' || a.branchId === effectiveBranch)).length;

  const exportReportXLSX = () => {
    const rows = completed.map(a => {
      const svc = data.services.find(s => s.id === a.serviceId), st = data.staff.find(s => s.id === a.staffId), cl = data.clients.find(c => c.id === a.clientId);
      return { Date: a.date, Time: a.start, Client: clientDisplayName(cl), Stylist: staffName(st), Service: svc?.name, Category: svc?.commissioned ? 'Commissioned' : 'Non-commissioned', 'Service Amount': a.serviceAmount, 'Product Sales': a.productsTotal, 'Payment Methods': a.payments.map(p => p.method).join(', '), Total: a.paidTotal };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `JusNatural_Report_${from}_to_${to}.xlsx`);
  };

  const exportPayrollXLSX = () => {
    const rows = payrollRows.map(p => ({ Staff: staffName(p), Branch: branches.find(b => b.id === p.branchId)?.name, 'Pay type': PAY_LABEL[p.payType], Jobs: p.jobs, 'Commissionable Revenue': p.commissionableRevenue, 'Product Sales': p.productRevenue, 'Base Wage': p.base, Commission: p.commission, Total: p.total }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Payroll');
    XLSX.writeFile(wb, `JusNatural_Payroll_${payPeriod.start}_to_${payPeriod.end}.xlsx`);
  };

  const branchText = effectiveBranch === 'all' ? 'All branches' : branchLabel(branches.find(b => b.id === effectiveBranch));

  const printReport = () => setPrintPayload({
    title: 'Jus Natural Hair Studio — Report', subtitle: `${fmtDateShort(from)} – ${fmtDateShort(to)} · ${branchText}`,
    columns: ['Date', 'Client', 'Stylist', 'Service', 'Total'],
    rows: completed.map(a => { const svc = data.services.find(s => s.id === a.serviceId), st = data.staff.find(s => s.id === a.staffId), cl = data.clients.find(c => c.id === a.clientId); return [fmtDateShort(a.date), clientDisplayName(cl), staffName(st), svc?.name, money(a.paidTotal)]; }),
  });
  const printPayroll = () => setPrintPayload({
    title: 'Jus Natural Hair Studio — Payroll', subtitle: `${fmtDateShort(payPeriod.start)} – ${fmtDateShort(payPeriod.end)} · ${branchText}`,
    columns: ['Staff', 'Branch', 'Pay type', 'Jobs', 'Commissionable Rev.', 'Product Sales', 'Base', 'Commission', 'Total'],
    rows: payrollRows.map(p => [staffName(p), branches.find(b => b.id === p.branchId)?.name, PAY_LABEL[p.payType], p.jobs, money(p.commissionableRevenue), money(p.productRevenue), money(p.base), money(p.commission), money(p.total)]),
  });

  return (
    <div style={{ padding: '20px 28px', height: '100vh', overflow: 'auto', boxSizing: 'border-box' }}>
      <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, marginBottom: 4, letterSpacing: -0.3 }}>Reports</div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 18 }}>
        Live from the database — updates as appointments are checked out.
        {!canExport && ' You have view access; exporting is limited to owner accounts.'}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 22, flexWrap: 'wrap' }}>
        <FieldInline label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} /></FieldInline>
        <FieldInline label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} /></FieldInline>
        <FieldInline label="Branch">
          {lockedBranch ? <div style={{ ...inputStyle, background: PAPER }}>{branchLabel(branches.find(b => b.id === lockedBranch))}</div> : (
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} style={selectStyle}>
              <option value="all">All branches</option>{branches.map(b => <option key={b.id} value={b.id}>{branchLabel(b)}</option>)}
            </select>
          )}
        </FieldInline>
        {canExport && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button onClick={exportReportXLSX} style={ghostBtnStyle}><Download size={14} /> Excel</button>
            <button onClick={printReport} style={ghostBtnStyle}><FileText size={14} /> PDF</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
        <StatCard label="Revenue" value={money(totalRevenue)} />
        <StatCard label="Completed appointments" value={completed.length} />
        <StatCard label="Avg. ticket" value={completed.length ? money(totalRevenue / completed.length) : '$0.00'} />
        {voidedCount > 0 && <StatCard label="Voided payments" value={voidedCount} accent={DANGER} />}
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 30, flexWrap: 'wrap' }}>
        {byStaffChart.length > 0 && (
          <div className="jn-card" style={{ flex: 2, minWidth: 320, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: MUTED }}>Revenue by stylist</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byStaffChart}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: MUTED }} axisLine={{ stroke: BORDER }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}` }} />
                <Bar dataKey="revenue" fill={PRIMARY} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="jn-card" style={{ flex: 1, minWidth: 200, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: MUTED }}>Revenue by payment method</div>
          {Object.keys(byMethod).length === 0 ? <div style={{ fontSize: 13, color: MUTED }}>No payments yet.</div> : PAYMENT_METHODS.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '5px 0', borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><m.icon size={13} color={MUTED} /> {m.label}</span>
              <span style={{ fontWeight: 600 }}>{money(byMethod[m.id] || 0)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Bi-weekly payroll</div>
          <div style={{ fontSize: 12, color: MUTED }}>{fmtDateShort(payPeriod.start)} – {fmtDateShort(payPeriod.end)} · Friday–Thursday cutoff</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setPayPeriodStart(addDaysISO(payPeriodStart, -14))} style={iconBtnStyle}><ChevronLeft size={16} /></button>
          <button onClick={() => setPayPeriodStart(getPayPeriod(todayISO()).start)} style={{ ...ghostBtnStyle, padding: '7px 12px' }}>Current period</button>
          <button onClick={() => setPayPeriodStart(addDaysISO(payPeriodStart, 14))} style={iconBtnStyle}><ChevronRight size={16} /></button>
          {canExport && (
            <>
              <button onClick={exportPayrollXLSX} style={ghostBtnStyle}><Download size={14} /> Excel</button>
              <button onClick={printPayroll} style={ghostBtnStyle}><FileText size={14} /> PDF</button>
            </>
          )}
        </div>
      </div>
      <div className="jn-card" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', marginBottom: 10 }}>
        <TableHeader cols={['Staff', 'Branch', 'Pay type', 'Jobs', 'Commissionable Rev.', 'Product Sales', 'Base', 'Commission', 'Total']} />
        {payrollRows.map(p => (
          <div key={p.id} className="jn-row" style={rowStyle}>
            <div style={{ flex: 1.2, fontWeight: 600 }}>{staffName(p)}</div>
            <div style={{ flex: 1, color: MUTED }}>{branches.find(b => b.id === p.branchId)?.name}</div>
            <div style={{ flex: 1.2, color: MUTED }}>{PAY_LABEL[p.payType]}</div>
            <div style={{ flex: 0.6, color: MUTED }}>{p.jobs}</div>
            <div style={{ flex: 1, color: MUTED }}>{money(p.commissionableRevenue)}</div>
            <div style={{ flex: 1, color: MUTED }}>{money(p.productRevenue)}</div>
            <div style={{ flex: 1, color: MUTED }}>{money(p.base)}</div>
            <div style={{ flex: 1, color: MUTED }}>{money(p.commission)}</div>
            <div style={{ flex: 1, fontWeight: 600, color: PRIMARY_DARK }}>{money(p.total)}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: MUTED }}>Base wage is the flat amount entered per pay period. Non-commissioned services don't count toward commission. Voided payments are excluded. Product sales only add to payroll when a product's benefit is set to "Selling stylist."</div>

      {printPayload && (
        <div className="print-area">
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, marginBottom: 2 }}>{printPayload.title}</div>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 16 }}>{printPayload.subtitle}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{printPayload.columns.map((c, i) => <th key={i} style={{ textAlign: 'left', borderBottom: '2px solid #333', padding: '6px 8px' }}>{c}</th>)}</tr></thead>
            <tbody>{printPayload.rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j} style={{ borderBottom: '1px solid #ccc', padding: '6px 8px' }}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ shared bits ------------------------------ */
function ModalShell({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(25,20,32,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxHeight: '86vh', overflow: 'auto', background: CARD, borderRadius: 18, padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600, letterSpacing: -0.2 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FieldRow({ label, children, style }) {
  return <div style={{ marginBottom: 14, ...style }}><div style={{ fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 5 }}>{label}</div>{children}</div>;
}
function FieldInline({ label, children }) {
  return <div><div style={{ fontSize: 11, color: MUTED, fontWeight: 600, marginBottom: 4 }}>{label}</div>{children}</div>;
}
function TableHeader({ cols }) {
  return <div style={{ display: 'flex', padding: '10px 16px', background: PAPER, borderBottom: `1px solid ${BORDER}`, fontSize: 11.5, fontWeight: 600, color: MUTED, gap: 12 }}>{cols.map((c, i) => <div key={i} style={{ flex: i === cols.length - 1 ? '0 0 60px' : 1 }}>{c}</div>)}</div>;
}
function StatCard({ label, value, accent }) {
  return (
    <div className="jn-card" style={{ flex: 1, minWidth: 140, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 18px' }}>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: 'Fraunces, serif', fontWeight: 600, color: accent || INK }}>{value}</div>
    </div>
  );
}
function IconAction({ children, onClick, danger }) {
  return <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: danger ? DANGER : MUTED, padding: 2, display: 'flex' }}>{children}</button>;
}
function EmptyState({ text }) {
  return <div style={{ padding: '40px 20px', textAlign: 'center', color: MUTED, background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 14 }}>{text}</div>;
}

/* ------------------------------ style tokens ------------------------------ */
const inputStyle = { width: '100%', padding: '9px 11px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 13.5, boxSizing: 'border-box', fontFamily: 'inherit', color: INK };
const selectStyle = { ...inputStyle };
const primaryBtnStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 8, border: 'none', background: PRIMARY, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const ghostBtnStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 8, border: `1px solid ${BORDER}`, background: CARD, color: INK, fontSize: 13, cursor: 'pointer' };
const dangerGhostBtnStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 8, border: `1px solid ${DANGER}`, background: 'none', color: DANGER, fontSize: 13, cursor: 'pointer' };
const iconBtnStyle = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, background: CARD, cursor: 'pointer', display: 'flex' };
const rowStyle = { display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, gap: 12, fontSize: 13.5 };
