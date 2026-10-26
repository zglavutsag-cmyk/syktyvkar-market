const ADMIN_PASSWORD = 'admin123'; // ⚠️ ПОМЕНЯЙ НА СВОЙ ПАРОЛЬ!

// Проверка авторизации при загрузке
if (sessionStorage.getItem('adminAuth') === 'true') {
    showAdminPanel();
}

function login() {
    const password = document.getElementById('passwordInput').value;
    if (password === ADMIN_PASSWORD) {
        sessionStorage.setItem('adminAuth', 'true');
        showAdminPanel();
    } else {
        document.getElementById('errorMsg').style.display = 'block';
    }
}

function logout() {
    sessionStorage.removeItem('adminAuth');
    location.reload();
}

function showAdminPanel() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminPanel').classList.add('active');
    loadDashboard();
}

function showTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(tabId).classList.add('active');
    
    if (tabId === 'dashboard') loadDashboard();
    if (tabId === 'listings') loadListings();
    if (tabId === 'users') loadUsers();
    if (tabId === 'categories') loadCategories();
}

async function loadDashboard() {
    try {
        const res = await fetch('/api/admin/stats');
        const data = await res.json();
        document.getElementById('statListings').textContent = data.totalListings || 0;
        document.getElementById('statActive').textContent = data.activeListings || 0;
        document.getElementById('statUsers').textContent = data.totalUsers || 0;
        document.getElementById('statCategories').textContent = data.totalCategories || 0;
    } catch (e) { console.error(e); }
}

async function loadListings() {
    try {
        const res = await fetch('/api/admin/listings');
        const listings = await res.json();
        const tbody = document.getElementById('listingsTable');
        tbody.innerHTML = listings.map(l => `
            <tr>
                <td>${l.id}</td>
                <td>${l.title}</td>
                <td>${l.price === 0 ? 'Бесплатно' : l.price + ' ₽'}</td>
                <td><span class="status-badge status-${l.status}">${l.status}</span></td>
                <td>${new Date(l.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-warning" onclick="toggleListing(${l.id}, '${l.status}')">
                        ${l.status === 'active' ? 'Скрыть' : 'Показать'}
                    </button>
                    <button class="btn btn-danger" onclick="deleteListing(${l.id})">Удалить</button>
                </td>
            </tr>
        `).join('');
    } catch (e) { console.error(e); }
}

async function toggleListing(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'hidden' : 'active';
    await fetch(`/api/admin/listings/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
    });
    loadListings();
}

async function deleteListing(id) {
    if (!confirm('Удалить объявление?')) return;
    await fetch(`/api/admin/listings/${id}`, { method: 'DELETE' });
    loadListings();
}

async function loadUsers() {
    try {
        const res = await fetch('/api/admin/users');
        const users = await res.json();
        const tbody = document.getElementById('usersTable');
        tbody.innerHTML = users.map(u => `
            <tr>
                <td>${u.telegram_id}</td>
                <td>${u.first_name || '-'}</td>
                <td>${u.username || '-'}</td>
                <td>${new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-danger" onclick="blockUser('${u.telegram_id}')">
                        Заблокировать
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (e) { console.error(e); }
}

async function blockUser(userId) {
    if (!confirm('Заблокировать пользователя?')) return;
    await fetch(`/api/admin/users/${userId}/block`, { method: 'POST' });
    loadUsers();
}

async function loadCategories() {
    try {
        const res = await fetch('/api/categories');
        const cats = await res.json();
        const tbody = document.getElementById('categoriesTable');
        tbody.innerHTML = cats.map(c => `
            <tr>
                <td>${c.id}</td>
                <td>${c.icon}</td>
                <td>${c.name}</td>
                <td>
                    <button class="btn btn-danger" onclick="deleteCategory(${c.id})">Удалить</button>
                </td>
            </tr>
        `).join('');
    } catch (e) { console.error(e); }
}

async function addCategory() {
    const name = document.getElementById('catName').value;
    const icon = document.getElementById('catIcon').value;
    if (!name || !icon) return alert('Заполните все поля');
    
    await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, icon })
    });
    document.getElementById('catName').value = '';
    document.getElementById('catIcon').value = '';
    loadCategories();
}

async function deleteCategory(id) {
    if (!confirm('Удалить категорию?')) return;
    await fetch(`/api/admin/categories/${id}`, { method: 'DELETE' });
    loadCategories();
}

// Enter для входа
document.getElementById('passwordInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});
