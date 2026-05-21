const LOCAL_STORAGE_PREFIX = 'rentProDashboardData';
const DEFAULT_STATE = {
  tenants: [],
  settings: { theme: 'dark' },
  session: { loggedIn: false, user: null }
};
const useFirestore = true;
const firebaseConfig = {
  apiKey: "AIzaSyCdfz-05JhLZQEwi-15sL3xnV2P931yLy0",
  authDomain: "rent-817b0.firebaseapp.com",
  projectId: "rent-817b0",
  storageBucket: "rent-817b0.firebasestorage.app",
  messagingSenderId: "409499505702",
  appId: "1:409499505702:web:bc5571f94bc53bf6e5c2e7"
};
const FIRESTORE_USERS_COLLECTION = 'users';
let state = { ...DEFAULT_STATE };
let currentUser = null;
let selectedTenantId = null;
let editingTenantId = null;
let statusChart = null;
let monthlyChart = null;
let unsubscribeFirestore = null;
let pendingWrites = new Set();
let isApplyingRemote = false;
let isDataLoading = false;
const loginScreen = document.getElementById('loginScreen');
const appShell = document.getElementById('appShell');
const themeToggle = document.getElementById('themeToggle');
const toastContainer = document.getElementById('toastContainer');
const tenantModal = document.getElementById('tenantModal');
const tenantModalBody = document.getElementById('tenantModalBody');
const formTitle = document.getElementById('formTitle');
const saveButton = document.getElementById('saveButton');
const searchInput = document.getElementById('search');
const authLoader = document.getElementById('authLoader');
const skeletonOverlay = document.getElementById('skeletonOverlay');
const installButton = document.getElementById('installBtn');
const offlineBanner = document.getElementById('offlineBanner');
const userMenuButton = document.getElementById('userMenuButton');
const userDropdown = document.getElementById('userDropdown');
const formModal = document.getElementById('tenantFormModal');
let deferredInstallPrompt = null;

function initApp() {
  attachNav();
  applyTheme(state.settings.theme);
  showAuthLoader(true);
  registerServiceWorker();
  setupPWA();
  updateNetworkStatus();
  initFirebase();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  }
}

function setupPWA() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallButton(true);
    showToast('Install RentPro for a faster app experience', 'info');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    showInstallButton(false);
    showToast('RentPro installed successfully', 'success');
  });

  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);

  window.addEventListener('click', (event) => {
    if (!event.target.closest('.user-menu-container')) {
      userDropdown?.classList.add('hidden');
    }
  });
}

function showInstallButton(show) {
  if (!installButton) return;
  installButton.classList.toggle('hidden', !show);
}

async function promptInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice.outcome === 'accepted') {
    showToast('Installation accepted. Open RentPro from your home screen.', 'success');
  } else {
    showToast('Install dismissed. You can install later from the browser menu.', 'info');
  }
  deferredInstallPrompt = null;
  showInstallButton(false);
}

function updateNetworkStatus() {
  if (!offlineBanner) return;
  const offline = !navigator.onLine;
  offlineBanner.classList.toggle('hidden', !offline);
}

function updateUserMenu(user) {
  if (!userMenuButton) return;
  userMenuButton.textContent = user.displayName || user.email || 'Landlord';
}

function toggleUserMenu() {
  if (!userDropdown) return;
  userDropdown.classList.toggle('hidden');
}

function getStorageKey() {
  return `${LOCAL_STORAGE_PREFIX}_${currentUser ? currentUser.uid : 'guest'}`;
}

function loadState() {
  const raw = localStorage.getItem(getStorageKey());
  if (raw) {
    try {
      state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch (error) {
      state = { ...DEFAULT_STATE };
    }
  } else {
    state = { ...DEFAULT_STATE };
  }

  state.settings = { ...DEFAULT_STATE.settings, ...(state.settings || {}) };
  state.session = { ...DEFAULT_STATE.session, ...(state.session || {}) };
  state.tenants = Array.isArray(state.tenants) ? state.tenants.map(migrateTenant) : [];
}

function migrateTenant(tenant) {
  return {
    id: tenant.id || generateId(),
    name: tenant.name || '',
    room: tenant.room || '',
    phone: tenant.phone || '',
    rent: Number(tenant.rent || 0),
    electricity: Number(tenant.electricity || 0),
    total: Number(tenant.total || Number(tenant.rent || 0) + Number(tenant.electricity || 0)),
    date: tenant.date || '',
    status: tenant.status || 'Unpaid',
    history: Array.isArray(tenant.history) ? tenant.history : [],
    createdAt: tenant.createdAt || new Date().toISOString(),
    updatedAt: tenant.updatedAt || new Date().toISOString()
  };
}

function saveState() {
  localStorage.setItem(getStorageKey(), JSON.stringify(state));
}

function initFirebase() {
  if (!useFirestore || !window.firebase) {
    showAuthLoader(false);
    showLogin();
    renderBoard();
    return;
  }

  try {
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(firebaseConfig);
    }

    window.db = window.firebase.firestore();
    window.auth = window.firebase.auth();

    window.auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL).catch(() => {
      console.warn('Unable to set auth persistence, continuing with default.');
    });

    window.auth.onAuthStateChanged(async (user) => {
      showAuthLoader(false);
      if (user) {
        await handleUserSignedIn(user);
      } else {
        handleUserSignedOut();
      }
    });
  } catch (error) {
    console.warn('Firebase initialization failed', error);
    showAuthLoader(false);
    showLogin();
    renderBoard();
    updateFirebaseStatus('disconnected', 'Offline');
    showLoading(false);
  }
}

async function handleUserSignedIn(user) {
  currentUser = user;
  state.session.loggedIn = true;
  state.session.user = {
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || ''
  };

  updateUserMenu(user);
  loadState();
  saveState();
  showApp();
  await startFirestoreSync();
  renderBoard();
  showToast(`Welcome back, ${user.displayName || user.email || 'Landlord'}`, 'success');
}

function handleUserSignedOut() {
  currentUser = null;
  state = { ...DEFAULT_STATE };
  state.session.loggedIn = false;
  state.session.user = null;
  saveState();
  stopFirestoreSync();
  renderBoard();
  showLogin();
  updateFirebaseStatus('disconnected', 'Offline');
  showInstallButton(false);
  updateUserMenu({ email: 'Guest' });
  showSkeleton(false);
}

function showAuthLoader(visible) {
  if (!authLoader) return;
  authLoader.classList.toggle('hidden', !visible);
}

function showSkeleton(visible) {
  if (!skeletonOverlay) return;
  skeletonOverlay.classList.toggle('hidden', !visible);
  isDataLoading = visible;
}

// ---------- Firestore real-time sync helpers ----------
const FIRESTORE_PROJECT = firebaseConfig.projectId || 'rentpro-local';

function getTenantCollectionRef() {
  if (!window.db || !currentUser) return null;
  return window.db.collection(FIRESTORE_USERS_COLLECTION).doc(currentUser.uid).collection('tenants');
}

function updateFirebaseStatus(cssClass, text) {
  const el = document.getElementById('firebaseStatus');
  if (!el) return;
  el.classList.remove('disconnected', 'connecting', 'online');
  el.classList.add(cssClass);
  el.textContent = text;
}

function showLoading(visible) {
  const loader = document.getElementById('loadingScreen');
  if (!loader) return;
  loader.classList.toggle('hidden', !visible);
}

function startFirestoreSync() {
  if (!window.db || !currentUser) return;
  if (unsubscribeFirestore) return;

  const collectionRef = getTenantCollectionRef();
  if (!collectionRef) return;

  updateFirebaseStatus('connecting', 'Connecting...');
  showLoading(true);
  showSkeleton(true);

  unsubscribeFirestore = collectionRef.orderBy('createdAt', 'desc').onSnapshot(
    (snapshot) => {
      updateFirebaseStatus('online', 'Online');
      showLoading(false);
      showSkeleton(false);
      isApplyingRemote = true;

      const remoteTenants = snapshot.docs.map((doc) => migrateTenant({ id: doc.id, ...doc.data() }));
      state.tenants = remoteTenants;
      saveState();
      renderBoard();

      snapshot.docChanges().forEach((change) => {
        const id = change.doc.id;
        const skip = pendingWrites.has(id);
        if (skip) pendingWrites.delete(id);
        if (!skip) {
          if (change.type === 'added') showToast('Tenant added to your dashboard', 'info');
          if (change.type === 'modified') showToast('Tenant updated from cloud', 'info');
          if (change.type === 'removed') showToast('Tenant removed from cloud', 'info');
        }
      });

      isApplyingRemote = false;
    },
    (error) => {
      console.warn('Firestore listener error', error);
      updateFirebaseStatus('disconnected', 'Offline');
      showLoading(false);
      showSkeleton(false);
      showToast('Firebase connection error', 'error');
    }
  );
}

function stopFirestoreSync() {
  if (unsubscribeFirestore) {
    unsubscribeFirestore();
    unsubscribeFirestore = null;
  }
  updateFirebaseStatus('disconnected', 'Offline');
}

async function writeTenantToFirestore(tenant) {
  if (!useFirestore || !window.db || isApplyingRemote || !currentUser) return;
  try {
    pendingWrites.add(tenant.id);
    const collectionRef = getTenantCollectionRef();
    await collectionRef.doc(tenant.id).set({ ...tenant, updatedAt: new Date().toISOString() });
  } catch (error) {
    pendingWrites.delete(tenant.id);
    console.warn('Failed to write tenant to Firestore', error);
    showToast('Unable to sync tenant to cloud', 'error');
  }
}

async function deleteTenantFromFirestore(id) {
  if (!useFirestore || !window.db || isApplyingRemote || !currentUser) return;
  try {
    pendingWrites.add(id);
    const collectionRef = getTenantCollectionRef();
    await collectionRef.doc(id).delete();
  } catch (error) {
    pendingWrites.delete(id);
    console.warn('Failed to delete tenant from Firestore', error);
    showToast('Unable to delete tenant in cloud', 'error');
  }
}

async function restoreBackupToFirestore(tenants) {
  if (!useFirestore || !window.db || !currentUser) return;
  try {
    const batch = window.db.batch();
    const collectionRef = getTenantCollectionRef();
    tenants.forEach((t) => {
      const ref = collectionRef.doc(t.id);
      batch.set(ref, { ...t, updatedAt: new Date().toISOString() });
      pendingWrites.add(t.id);
    });
    await batch.commit();
  } catch (error) {
    console.warn('Failed to restore backup to Firestore', error);
    showToast('Unable to restore backup to cloud', 'error');
  }
}

function attachNav() {
  const navButtons = document.querySelectorAll('.nav-link, .bottom-nav-btn');
  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      navButtons.forEach((nav) => nav.classList.remove('active'));
      button.classList.add('active');
      const target = button.dataset.section;
      const section = document.getElementById(`${target}Section`);
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function openAddTenantModal() {
  editingTenantId = null;
  formTitle.textContent = 'Add Tenant';
  saveButton.textContent = 'Add Tenant';
  resetForm();
  formModal?.classList.remove('hidden');
}

function closeFormModal() {
  formModal?.classList.add('hidden');
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  appShell.classList.add('hidden');
}

function showApp() {
  loginScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
}

async function login() {
  const email = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value.trim();

  if (!window.auth) {
    showToast('Authentication service unavailable', 'error');
    return;
  }

  try {
    showLoading(true);
    await window.auth.signInWithEmailAndPassword(email, password);
    showLoading(false);
    // onAuthStateChanged will update UI and start sync
    showToast('Signed in successfully', 'success');
  } catch (error) {
    showLoading(false);
    const msg = (error && error.message) ? error.message : 'Login failed';
    showToast(msg, 'error');
  }
}

async function loginWithGoogle() {
  if (!window.auth || !window.firebase) {
    showToast('Authentication service unavailable', 'error');
    return;
  }

  try {
    showLoading(true);
    const provider = new window.firebase.auth.GoogleAuthProvider();
    await window.auth.signInWithPopup(provider);
    showLoading(false);
    showToast('Signed in with Google', 'success');
  } catch (error) {
    showLoading(false);
    showToast(error?.message || 'Google login failed', 'error');
  }
}

async function logout() {
  if (window.auth) {
    try {
      await window.auth.signOut();
      showToast('Signed out', 'info');
    } catch (error) {
      console.warn('Sign out failed', error);
      showToast('Sign out failed', 'error');
    }
  }
  state.session.loggedIn = false;
  saveState();
  stopFirestoreSync();
  showLogin();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.innerText = theme === 'dark' ? '🌙 Dark' : '☀️ Light';
  state.settings.theme = theme;
  saveState();
}

function toggleTheme() {
  const nextTheme = state.settings.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  showToast(`${nextTheme === 'dark' ? 'Dark' : 'Light'} mode activated`, 'info');
}

function renderBoard() {
  renderCards();
  renderTable();
  renderCharts();
}

function renderCards() {
  const today = new Date();
  const overdueTenants = state.tenants.filter((tenant) => {
    return tenant.status !== 'Paid' && tenant.date && new Date(tenant.date) < today;
  });
  const paidTotal = state.tenants.reduce((sum, tenant) => sum + (tenant.status === 'Paid' ? tenant.total : 0), 0);
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const monthCollection = state.tenants.reduce((sum, tenant) => {
    const due = new Date(tenant.date);
    if (due.getMonth() === currentMonth && due.getFullYear() === currentYear) {
      return sum + (tenant.status === 'Paid' ? tenant.total : 0);
    }
    return sum;
  }, 0);
  const currentMonthPending = state.tenants.reduce((sum, tenant) => {
    const due = new Date(tenant.date);
    if (tenant.status !== 'Paid' && due.getMonth() === currentMonth && due.getFullYear() === currentYear) {
      return sum + tenant.total;
    }
    return sum;
  }, 0);
  const currentMonthElectricity = state.tenants.reduce((sum, tenant) => {
    const due = new Date(tenant.date);
    if (due.getMonth() === currentMonth && due.getFullYear() === currentYear) {
      return sum + tenant.electricity;
    }
    return sum;
  }, 0);

  document.getElementById('totalTenants').innerText = state.tenants.length;
  document.getElementById('totalCollection').innerText = formatMoney(paidTotal);
  document.getElementById('overdueCount').innerText = overdueTenants.length;
  document.getElementById('monthCollection').innerText = formatMoney(monthCollection);
  document.getElementById('currentMonthCollected').innerText = formatMoney(monthCollection);
  document.getElementById('currentMonthPending').innerText = formatMoney(currentMonthPending);
  document.getElementById('currentMonthElectricity').innerText = formatMoney(currentMonthElectricity);
  document.getElementById('activeTenants').innerText = state.tenants.length;
}

function renderTable(searchQuery = searchInput.value.trim().toLowerCase()) {
  const tbody = document.getElementById('tenantList');
  tbody.innerHTML = '';

  if (isDataLoading) {
    for (let i = 0; i < 6; i += 1) {
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="8"><div class="skeleton-row"></div></td>`;
      tbody.appendChild(row);
    }
    return;
  }

  const rows = state.tenants
    .filter((tenant) => {
      if (!searchQuery) return true;
      return [tenant.name, tenant.room, tenant.phone, tenant.status]
        .join(' ')
        .toLowerCase()
        .includes(searchQuery);
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No tenants found. Add a tenant or restore a backup.</td></tr>`;
    return;
  }

  const today = new Date();
  rows.forEach((tenant) => {
    const dueDate = tenant.date ? new Date(tenant.date) : null;
    const isOverdue = tenant.status !== 'Paid' && dueDate && dueDate < today;
    const row = document.createElement('tr');
    if (isOverdue) row.classList.add('overdue-row');

    row.innerHTML = `
      <td>${tenant.name}</td>
      <td>${tenant.room}</td>
      <td>${formatMoney(tenant.rent)}</td>
      <td>${formatMoney(tenant.electricity)}</td>
      <td>${formatMoney(tenant.total)}</td>
      <td>${formatDate(tenant.date)}</td>
      <td><span class="status-pill ${tenant.status === 'Paid' ? 'status-paid' : 'status-unpaid'}">${tenant.status}</span></td>
      <td>
        <button class="view-btn" onclick="viewProfile('${tenant.id}')">View</button>
        <button class="edit-btn" onclick="startEdit('${tenant.id}')">Edit</button>
        <button class="remind-btn" onclick="markPaid('${tenant.id}')">Paid</button>
        <button class="remind-btn" onclick="sendReminder('${tenant.id}')">Remind</button>
        <button class="delete-btn" onclick="deleteTenant('${tenant.id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function gatherFormData() {
  return {
    name: document.getElementById('name').value.trim(),
    room: document.getElementById('room').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    rent: Number(document.getElementById('rent').value || 0),
    electricity: Number(document.getElementById('electricity').value || 0),
    date: document.getElementById('date').value
  };
}

function validateTenant(data) {
  if (!data.name || !data.room || !data.phone || !data.rent || !data.date) {
    showToast('Please fill in all required tenant fields', 'error');
    return false;
  }
  return true;
}

function submitTenant() {
  const tenantData = gatherFormData();
  if (!validateTenant(tenantData)) return;

  if (editingTenantId) {
    updateTenant(editingTenantId, tenantData);
  } else {
    addTenant(tenantData);
  }
  closeFormModal();
}

function addTenant(data) {
  const tenant = {
    id: generateId(),
    ...data,
    total: data.rent + data.electricity,
    status: 'Unpaid',
    history: [],
    createdAt: new Date().toISOString()
  };

  state.tenants.unshift(tenant);
  saveState();
  // Optimistic write to Firestore (will be reconciled by onSnapshot)
  if (useFirestore) writeTenantToFirestore(tenant);
  resetForm();
  renderBoard();
  showToast('Tenant added successfully', 'success');
}

function updateTenant(id, data) {
  const tenant = state.tenants.find((item) => item.id === id);
  if (!tenant) {
    showToast('Tenant not found', 'error');
    return;
  }

  tenant.name = data.name;
  tenant.room = data.room;
  tenant.phone = data.phone;
  tenant.rent = data.rent;
  tenant.electricity = data.electricity;
  tenant.total = data.rent + data.electricity;
  tenant.date = data.date;
  saveState();
  if (useFirestore) writeTenantToFirestore(tenant);
  resetForm();
  renderBoard();
  showToast('Tenant record updated', 'success');
}

function startEdit(id) {
  const tenant = state.tenants.find((item) => item.id === id);
  if (!tenant) return;

  editingTenantId = id;
  formTitle.textContent = 'Edit Tenant';
  saveButton.textContent = 'Save Changes';
  document.getElementById('name').value = tenant.name;
  document.getElementById('room').value = tenant.room;
  document.getElementById('phone').value = tenant.phone;
  document.getElementById('rent').value = tenant.rent;
  document.getElementById('electricity').value = tenant.electricity;
  document.getElementById('date').value = tenant.date;
  formModal?.classList.remove('hidden');
  showToast('Editing tenant details', 'info');
}

function resetForm() {
  editingTenantId = null;
  formTitle.textContent = 'Add Tenant';
  saveButton.textContent = 'Add Tenant';
  document.getElementById('name').value = '';
  document.getElementById('room').value = '';
  document.getElementById('phone').value = '';
  document.getElementById('rent').value = '';
  document.getElementById('electricity').value = '';
  document.getElementById('date').value = '';
}

function deleteTenant(id) {
  if (!confirm('Delete this tenant record permanently?')) return;
  // Optimistic local removal; also remove from Firestore if enabled.
  state.tenants = state.tenants.filter((item) => item.id !== id);
  saveState();
  if (useFirestore) deleteTenantFromFirestore(id);
  renderBoard();
  showToast('Tenant deleted', 'success');
}

function markPaid(id) {
  const tenant = state.tenants.find((item) => item.id === id);
  if (!tenant) return;
  if (tenant.status === 'Paid') {
    showToast('Tenant is already marked paid', 'info');
    return;
  }

  tenant.status = 'Paid';
  const paymentDate = new Date().toISOString();
  tenant.history.push({
    id: generateId(),
    date: paymentDate,
    type: 'Rent Paid',
    amount: tenant.total
  });
  saveState();
  if (useFirestore) writeTenantToFirestore(tenant);
  renderBoard();
  showToast('Payment recorded successfully', 'success');
}

function sendReminder(id) {
  const tenant = state.tenants.find((item) => item.id === id);
  if (!tenant) return;
  if (!tenant.phone) {
    showToast('Phone number is required for WhatsApp reminders', 'error');
    return;
  }

  const message = `Hello ${tenant.name},\n\nYour rent payment is pending.\nRoom: ${tenant.room}\nAmount: ${formatMoney(tenant.total)}\nDue Date: ${formatDate(tenant.date)}\n\nPlease pay as soon as possible.`;
  const url = `https://wa.me/91${tenant.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
  showToast('WhatsApp reminder ready', 'success');
}

function viewProfile(id) {
  const tenant = state.tenants.find((item) => item.id === id);
  if (!tenant) return;
  selectedTenantId = id;
  const overdue = tenant.status !== 'Paid' && tenant.date && new Date(tenant.date) < new Date();
  tenantModalBody.innerHTML = `
    <div class="modal-summary">
      <div><strong>Name</strong><p>${tenant.name}</p></div>
      <div><strong>Room</strong><p>${tenant.room}</p></div>
      <div><strong>Phone</strong><p>${tenant.phone}</p></div>
      <div><strong>Rent</strong><p>${formatMoney(tenant.rent)}</p></div>
      <div><strong>Electricity</strong><p>${formatMoney(tenant.electricity)}</p></div>
      <div><strong>Total</strong><p>${formatMoney(tenant.total)}</p></div>
      <div><strong>Due Date</strong><p>${formatDate(tenant.date)}</p></div>
      <div><strong>Status</strong><p>${tenant.status}${overdue ? ' • Overdue' : ''}</p></div>
    </div>
    <div class="history-card">
      <h4>Payment History</h4>
      ${tenant.history.length === 0 ? '<p class="table-empty">No payment history available.</p>' : '<ul>' + tenant.history.map((payment) => `<li>${formatDate(payment.date)} • ${payment.type} • ${formatMoney(payment.amount)}</li>`).join('') + '</ul>'}
    </div>
  `;
  document.getElementById('modalTitle').textContent = `${tenant.name} Profile`;
  tenantModal.classList.remove('hidden');
}

function closeModal() {
  tenantModal.classList.add('hidden');
}

function generateReceipt() {
  const tenant = state.tenants.find((item) => item.id === selectedTenantId);
  if (!tenant) {
    showToast('Select a tenant profile first', 'error');
    return;
  }
  if (!window.jspdf) {
    showToast('PDF library unavailable', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(20);
  doc.text('RentPro Receipt', 20, 25);
  doc.setFontSize(11);
  doc.text(`Tenant: ${tenant.name}`, 20, 45);
  doc.text(`Room: ${tenant.room}`, 20, 55);
  doc.text(`Phone: ${tenant.phone}`, 20, 65);
  doc.text(`Rent: ${formatMoney(tenant.rent)}`, 20, 85);
  doc.text(`Electricity: ${formatMoney(tenant.electricity)}`, 20, 95);
  doc.text(`Total Amount: ${formatMoney(tenant.total)}`, 20, 105);
  doc.text(`Payment Date: ${formatDate(new Date().toISOString())}`, 20, 115);
  doc.text('Thank you for using RentPro.', 20, 145);
  doc.save(`RentPro_Receipt_${tenant.name.replace(/\s+/g, '_')}.pdf`);
  showToast('PDF receipt generated', 'success');
}

function exportCSV() {
  if (state.tenants.length === 0) {
    showToast('No tenant data to export', 'error');
    return;
  }

  const headers = ['Name', 'Room', 'Phone', 'Rent', 'Electricity', 'Total', 'Due Date', 'Status'];
  const rows = state.tenants.map((tenant) => [
    tenant.name,
    tenant.room,
    tenant.phone,
    tenant.rent,
    tenant.electricity,
    tenant.total,
    tenant.date,
    tenant.status
  ]);

  const csv = [headers.join(','), ...rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))].join('\n');
  downloadFile('rentpro-data.csv', csv, 'text/csv');
  showToast('CSV export ready', 'success');
}

function downloadBackup() {
  const backup = JSON.stringify(state, null, 2);
  downloadFile('rentpro-backup.json', backup, 'application/json');
  showToast('Backup downloaded', 'success');
}

function restoreBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!Array.isArray(payload.tenants)) {
        throw new Error('Invalid backup format');
      }
      state.tenants = payload.tenants.map(migrateTenant);
      saveState();
      renderBoard();
      showToast('Backup restored locally', 'success');
      // Push backup to Firestore in batch for real-time propagation
      if (useFirestore) restoreBackupToFirestore(state.tenants).then(() => {
        showToast('Backup synced to cloud', 'success');
      });
    } catch (error) {
      showToast('Unable to restore backup', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function downloadFile(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function renderCharts() {
  const today = new Date();
  const paidCount = state.tenants.filter((tenant) => tenant.status === 'Paid').length;
  const unpaidCount = state.tenants.filter((tenant) => tenant.status !== 'Paid').length;
  const monthLabels = [];
  const monthValues = [];

  for (let i = 5; i >= 0; i -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const label = date.toLocaleString('default', { month: 'short' });
    monthLabels.push(label);
    const monthSum = state.tenants.reduce((sum, tenant) => {
      const due = new Date(tenant.date);
      if (due.getMonth() === date.getMonth() && due.getFullYear() === date.getFullYear()) {
        return sum + (tenant.status === 'Paid' ? tenant.total : 0);
      }
      return sum;
    }, 0);
    monthValues.push(monthSum);
  }

  const statusCtx = document.getElementById('statusChart').getContext('2d');
  const monthlyCtx = document.getElementById('monthlyChart').getContext('2d');

  if (statusChart) statusChart.destroy();
  if (monthlyChart) monthlyChart.destroy();

  statusChart = new Chart(statusCtx, {
    type: 'doughnut',
    data: {
      labels: ['Paid', 'Unpaid'],
      datasets: [{
        data: [paidCount, unpaidCount],
        backgroundColor: ['#22c55e', '#ef4444'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#d1d5db' } }
      }
    }
  });

  monthlyChart = new Chart(monthlyCtx, {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [{
        label: 'Collected',
        data: monthValues,
        backgroundColor: '#38bdf8',
        borderRadius: 12,
        maxBarThickness: 28
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { display: false } },
        y: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.08)' } }
      }
    }
  });
}

function searchTenant() {
  renderTable();
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function formatMoney(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB');
}

function generateId() {
  return `tenant-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

window.addEventListener('DOMContentLoaded', initApp);
window.login = login;
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;
window.toggleTheme = toggleTheme;
window.submitTenant = submitTenant;
window.resetForm = resetForm;
window.searchTenant = searchTenant;
window.markPaid = markPaid;
window.sendReminder = sendReminder;
window.deleteTenant = deleteTenant;
window.startEdit = startEdit;
window.viewProfile = viewProfile;
window.closeModal = closeModal;
window.openAddTenantModal = openAddTenantModal;
window.closeFormModal = closeFormModal;
window.generateReceipt = generateReceipt;
window.exportCSV = exportCSV;
window.downloadBackup = downloadBackup;
window.restoreBackup = restoreBackup;