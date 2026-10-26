// ============================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================
let currentUser = null;
let currentCity = 'Сыктывкар';
let isMaxApp = false;

// ============================================
// ИНИЦИАЛИЗАЦИЯ MAX SDK (если доступно)
// ============================================
if (window.MaxWebApp) {
    isMaxApp = true;
    window.MaxWebApp.ready();
    window.MaxWebApp.expand();
    
    const maxUser = window.MaxWebApp.initDataUnsafe?.user;
    if (maxUser) {
        currentUser = {
            telegram_id: 'max_' + maxUser.id,
            username: maxUser.username || 'max_user',
            first_name: maxUser.first_name || 'Пользователь MAX'
        };
        localStorage.setItem('user', JSON.stringify(currentUser));
    }
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
    } else {
        currentUser = {
            telegram_id: 'demo_user_' + Date.now(),
            username: 'demo_user',
            first_name: 'Демо Пользователь'
        };
        localStorage.setItem('user', JSON.stringify(currentUser));
    }

    if (document.getElementById('categories-grid')) {
        loadCategories();
        const categoryFromUrl = getQueryParam('category');
        loadListings(categoryFromUrl);
    }
    
    if (document.getElementById('listing-detail')) {
        const listingId = getQueryParam('id');
        if (listingId) loadListingDetail(listingId);
    }
    
    if (document.getElementById('create-form')) {
        loadCategoriesForSelect();
    }
    
    if (document.getElementById('my-listings')) {
        loadMyListings();
    }
    
    if (document.getElementById('favorites-list')) {
        loadFavorites();
    }
    
    if (document.getElementById('chats-list')) {
        loadChats();
    }
    
    if (document.getElementById('chat-messages')) {
        const chatId = getQueryParam('id');
        if (chatId) loadChatMessages(chatId);
    }
    
    if (document.getElementById('reviews-list')) {
        const userId = getQueryParam('userId');
        if (userId) loadReviews(userId);
    }
    
    const userNameEl = document.getElementById('user-name');
    if (userNameEl && currentUser.first_name) {
        userNameEl.textContent = currentUser.first_name;
    }
    
    loadUnreadBadge();
});

// ============================================
// УТИЛИТЫ
// ============================================
function getQueryParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

function formatPrice(price) {
    if (!price || price === 0) return 'Договорная';
    return Number(price).toLocaleString('ru-RU') + ' ₽';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Только что';
    if (diffMins < 60) return `${diffMins} мин. назад`;
    if (diffHours < 24) return `${diffHours} ч. назад`;
    if (diffDays < 7) return `${diffDays} дн. назад`;
    
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// ============================================
// СЧЁТЧИК НЕПРОЧИТАННЫХ
// ============================================
async function loadUnreadBadge() {
    try {
        const response = await fetch(`/api/unread-count?telegramId=${currentUser.telegram_id}`);
        const data = await response.json();
        
        const badge = document.getElementById('unread-badge');
        if (badge && data.count > 0) {
            badge.textContent = data.count > 99 ? '99+' : data.count;
            badge.style.display = 'flex';
        }
    } catch (error) {
        console.error('Ошибка загрузки счётчика:', error);
    }
}

// ============================================
// ЗАГРУЗКА КАТЕГОРИЙ
// ============================================
async function loadCategories() {
    try {
        const response = await fetch('/api/categories');
        const categories = await response.json();
        
        const grid = document.getElementById('categories-grid');
        if (!grid) return;
        
        const activeCategory = getQueryParam('category');
        
        const allButton = document.createElement('a');
        allButton.href = 'index.html';
        allButton.className = 'category-item';
        allButton.innerHTML = `
            <div class="category-icon">📋</div>
            <div class="category-name">Все</div>
        `;
        grid.appendChild(allButton);
        
        categories.forEach(cat => {
            const isActive = activeCategory === String(cat.id);
            const link = document.createElement('a');
            link.href = `index.html?category=${cat.id}`;
            link.className = 'category-item';
            if (isActive) {
                link.style.background = 'var(--accent-blue)';
                link.style.color = 'white';
            }
            link.innerHTML = `
                <div class="category-icon">${cat.icon}</div>
                <div class="category-name" style="${isActive ? 'color: white;' : ''}">${cat.name}</div>
            `;
            grid.appendChild(link);
        });
        
    } catch (error) {
        console.error('Ошибка загрузки категорий:', error);
    }
}

// ============================================
// ЗАГРУЗКА ОБЪЯВЛЕНИЙ (название сверху, цена снизу, бейдж БЕСПЛАТНО)
// ============================================
async function loadListings(categoryId = null) {
    try {
        const url = categoryId 
            ? `/api/listings?category=${categoryId}&city=${currentCity}`
            : `/api/listings?city=${currentCity}`;
        
        const response = await fetch(url);
        const listings = await response.json();
        
        const container = document.getElementById('listings-container');
        if (!container) return;
        
        if (listings.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div class="empty-title">Пока нет объявлений</div>
                    <div class="empty-text">Будь первым — размести своё объявление!</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = `<div class="listings-grid">` + listings.map(listing => {
            const isFree = listing.price === 0;
            return `
                <a href="listing.html?id=${listing.id}" class="listing-card" style="position: relative; border: ${listing.is_vip ? '2px solid #ffd700' : (isFree ? '2px solid #4caf50' : 'none')}">
                    ${listing.is_vip ? '<div class="listing-vip">⭐ VIP</div>' : ''}
                    ${isFree ? '<div class="free-badge">БЕСПЛАТНО</div>' : ''}
                    <div class="listing-image">
                        ${listing.main_image 
                            ? `<img src="/uploads/${listing.main_image}" alt="${listing.title}">`
                            : listing.category_icon || '📦'
                        }
                    </div>
                    <div class="listing-info">
                        <div class="listing-title">${listing.title}</div>
                        <div class="listing-price" style="${isFree ? 'color: #4caf50; font-weight: 700;' : ''}">${isFree ? 'Отдам даром' : formatPrice(listing.price)}</div>
                        <div class="listing-meta">
                            <span>${listing.city}</span>
                            <span>${formatDate(listing.created_at)}</span>
                        </div>
                    </div>
                </a>
            `;
        }).join('') + `</div>`;
    } catch (error) {
        console.error('Ошибка загрузки объявлений:', error);
    }
}

// ============================================
// ДЕТАЛИ ОБЪЯВЛЕНИЯ
// ============================================
async function loadListingDetail(listingId) {
    try {
        const response = await fetch(`/api/listings/${listingId}`);
        const listing = await response.json();
        
        const container = document.getElementById('listing-detail');
        if (!container) return;
        
        const isFree = listing.price === 0;
        
        container.innerHTML = `
            <div class="listing-gallery">
                ${listing.images && listing.images.length > 0 
                    ? `<img src="/uploads/${listing.images[0].filename}" alt="${listing.title}">`
                    : listing.category_icon || ''
                }
            </div>
            <div class="listing-content">
                ${isFree ? '<div style="display: inline-block; background: #4caf50; color: white; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 14px; margin-bottom: 12px;">🎁 БЕСПЛАТНО</div>' : ''}
                <div class="listing-detail-title">${listing.title}</div>
                <div class="listing-detail-price" style="${isFree ? 'color: #4caf50;' : ''}">${isFree ? 'Отдам даром' : formatPrice(listing.price)}</div>
                <div class="listing-detail-meta">
                    <span>📍 ${listing.city}</span>
                    <span>👁️ ${listing.views} просмотров</span>
                    <span>${formatDate(listing.created_at)}</span>
                </div>
                <div class="listing-detail-description">${listing.description || 'Описание не указано'}</div>
                
                <div class="seller-info">
                    <div class="seller-avatar">${(listing.first_name || 'U')[0].toUpperCase()}</div>
                    <div class="seller-details">
                        <div class="seller-name">${listing.first_name || listing.username}</div>
                        <div class="seller-rating">
                            <a href="reviews.html?userId=${listing.seller_id}" style="color: var(--accent-blue); text-decoration: none;">
                                ⭐ ${listing.rating ? listing.rating.toFixed(1) : '5.0'} (${listing.total_reviews} отзывов)
                            </a>
                        </div>
                    </div>
                </div>
                
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="contactSeller('${listing.seller_id}', ${listing.id})">
                        💬 Написать
                    </button>
                    <button class="btn btn-secondary" onclick="addToFavorites(${listing.id})">
                        ❤️ В избранное
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Ошибка загрузки объявления:', error);
    }
}

// ============================================
// СОЗДАНИЕ ОБЪЯВЛЕНИЯ
// ============================================
async function loadCategoriesForSelect() {
    try {
        const response = await fetch('/api/categories');
        const categories = await response.json();
        
        const select = document.getElementById('category-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">Выберите категорию</option>' + 
            categories.map(cat => `
                <option value="${cat.id}">${cat.icon} ${cat.name}</option>
            `).join('');
    } catch (error) {
        console.error('Ошибка загрузки категорий:', error);
    }
}

document.addEventListener('submit', async (e) => {
    if (e.target.id === 'create-form') {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        formData.append('telegramId', currentUser.telegram_id);
        formData.append('username', currentUser.username);
        formData.append('firstName', currentUser.first_name);
        
        // Обработка чекбокса isBusiness
        const isBusinessCheckbox = document.getElementById('isBusiness');
        if (isBusinessCheckbox && isBusinessCheckbox.checked) {
            formData.append('isBusiness', '1');
        } else {
            formData.append('isBusiness', '0');
        }
        
        try {
            const response = await fetch('/api/listings', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                alert('✅ Объявление создано!');
                window.location.href = 'my-listings.html';
            } else {
                alert('❌ Ошибка: ' + (result.error || 'Неизвестная ошибка'));
            }
        } catch (error) {
            console.error('Ошибка создания объявления:', error);
            alert('❌ Ошибка соединения с сервером');
        }
    }
});

// ============================================
// МОИ ОБЪЯВЛЕНИЯ
// ============================================
async function loadMyListings() {
    try {
        const response = await fetch(`/api/my-listings?telegramId=${currentUser.telegram_id}`);
        const listings = await response.json();
        
        const container = document.getElementById('my-listings');
        if (!container) return;
        
        if (listings.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📝</div>
                    <div class="empty-title">У вас пока нет объявлений</div>
                    <div class="empty-text">Разместите первое объявление и начните продавать!</div>
                    <div style="display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; justify-content: center;">
                        <a href="create.html" class="btn btn-primary" style="width: auto; padding: 12px 24px; margin: 0;">
                            ➕ Создать объявление
                        </a>
                        <a href="create-business.html" class="btn" style="width: auto; padding: 12px 24px; margin: 0; background: linear-gradient(135deg, #ffd700, #ffaa00); color: #000; font-weight: 700;">
                            🏪 Создать магазин
                        </a>
                    </div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = `<div class="listings-grid">` + listings.map(listing => {
            const isFree = listing.price === 0;
            return `
                <div class="listing-card" style="position: relative; border: ${listing.is_vip ? '2px solid #ffd700' : (isFree ? '2px solid #4caf50' : 'none')}">
                    ${listing.is_vip ? '<div class="listing-vip">⭐ VIP</div>' : ''}
                    ${isFree ? '<div class="free-badge">БЕСПЛАТНО</div>' : ''}
                    <a href="listing.html?id=${listing.id}">
                        <div class="listing-image">
                            ${listing.main_image 
                                ? `<img src="/uploads/${listing.main_image}" alt="${listing.title}">`
                                : listing.category_icon || '📦'
                            }
                        </div>
                        <div class="listing-info">
                            <div class="listing-title">${listing.title}</div>
                            <div class="listing-price" style="${isFree ? 'color: #4caf50; font-weight: 700;' : ''}">${isFree ? 'Отдам даром' : formatPrice(listing.price)}</div>
                            <div class="listing-meta">
                                <span>👁️ ${listing.views}</span>
                                <span>${formatDate(listing.created_at)}</span>
                            </div>
                        </div>
                    </a>
                    <div style="padding: 8px; display: flex; gap: 4px; border-top: 1px solid var(--border-color);">
                        <button onclick="bumpListing(${listing.id})" style="flex: 1; background: var(--accent-blue); color: white; border: none; border-radius: 6px; padding: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
                            ⬆️ 29 ₽
                        </button>
                        <button onclick="makeVipListing(${listing.id})" style="flex: 1; background: #ffd700; color: #000; border: none; border-radius: 6px; padding: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
                            ⭐ 49 ₽
                        </button>
                        <button onclick="deleteListing(${listing.id})" style="background: #f44336; color: white; border: none; border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: 600; cursor: pointer;">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('') + `</div>`;
    } catch (error) {
        console.error('Ошибка загрузки моих объявлений:', error);
    }
}

async function deleteListing(listingId) {
    if (!confirm('Удалить это объявление?')) return;
    
    try {
        const response = await fetch(`/api/listings/${listingId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId: currentUser.telegram_id })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('✅ Объявление удалено');
            loadMyListings();
        } else {
            alert('❌ Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка удаления:', error);
        alert('❌ Ошибка соединения');
    }
}

// ============================================
// ИЗБРАННОЕ
// ============================================
async function addToFavorites(listingId) {
    try {
        const response = await fetch('/api/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: currentUser.telegram_id,
                listingId: listingId
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('✅ Добавлено в избранное');
        } else {
            alert('ℹ️ ' + result.message);
        }
    } catch (error) {
        console.error('Ошибка добавления в избранное:', error);
    }
}

async function loadFavorites() {
    try {
        const response = await fetch(`/api/favorites?telegramId=${currentUser.telegram_id}`);
        const listings = await response.json();
        
        const container = document.getElementById('favorites-list');
        if (!container) return;
        
        if (listings.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">❤️</div>
                    <div class="empty-title">Избранное пусто</div>
                    <div class="empty-text">Добавляйте объявления в избранное, чтобы не потерять</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = `<div class="listings-grid">` + listings.map(listing => {
            const isFree = listing.price === 0;
            return `
                <a href="listing.html?id=${listing.id}" class="listing-card" style="position: relative; border: ${isFree ? '2px solid #4caf50' : 'none'}">
                    ${isFree ? '<div class="free-badge">БЕСПЛАТНО</div>' : ''}
                    <div class="listing-image">
                        ${listing.main_image 
                            ? `<img src="/uploads/${listing.main_image}" alt="${listing.title}">`
                            : listing.category_icon || '📦'
                        }
                    </div>
                    <div class="listing-info">
                        <div class="listing-title">${listing.title}</div>
                        <div class="listing-price" style="${isFree ? 'color: #4caf50; font-weight: 700;' : ''}">${isFree ? 'Отдам даром' : formatPrice(listing.price)}</div>
                        <div class="listing-meta">
                            <span>${listing.city}</span>
                            <span>${formatDate(listing.created_at)}</span>
                        </div>
                    </div>
                </a>
            `;
        }).join('') + `</div>`;
    } catch (error) {
        console.error('Ошибка загрузки избранного:', error);
    }
}

// ============================================
// СВЯЗЬ С ПРОДАВЦОМ
// ============================================
async function contactSeller(sellerId, listingId) {
    try {
        const response = await fetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                buyerId: currentUser.telegram_id,
                sellerId: sellerId,
                listingId: listingId
            })
        });
        
        const result = await response.json();
        
        if (result.chatId) {
            window.location.href = `chat.html?id=${result.chatId}`;
        } else {
            alert('❌ ' + (result.error || 'Не удалось открыть чат'));
        }
    } catch (error) {
        console.error('Ошибка создания чата:', error);
        alert('❌ Ошибка соединения');
    }
}

// ============================================
// СПИСОК ЧАТОВ
// ============================================
async function loadChats() {
    try {
        const response = await fetch(`/api/chats?telegramId=${currentUser.telegram_id}`);
        const chats = await response.json();
        
        const container = document.getElementById('chats-list');
        if (!container) return;
        
        if (chats.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">💬</div>
                    <div class="empty-title">У вас пока нет чатов</div>
                    <div class="empty-text">Нажмите "Написать" в любом объявлении, чтобы начать общение</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = chats.map(chat => `
            <a href="chat.html?id=${chat.chat_id}" class="chat-item">
                <div class="chat-avatar">
                    ${(chat.companion_name || 'U')[0].toUpperCase()}
                    ${chat.unread_count > 0 ? `<div class="chat-unread-badge">${chat.unread_count}</div>` : ''}
                </div>
                <div class="chat-info">
                    <div class="chat-header">
                        <div class="chat-name">${chat.companion_name || 'Пользователь'}</div>
                        <div class="chat-time">${chat.last_message_time ? formatTime(chat.last_message_time) : formatDate(chat.chat_created)}</div>
                    </div>
                    <div class="chat-listing">📦 ${chat.listing_title}</div>
                    <div class="chat-last-message">
                        ${chat.last_message || 'Нет сообщений'}
                    </div>
                </div>
            </a>
        `).join('');
    } catch (error) {
        console.error('Ошибка загрузки чатов:', error);
    }
}

// ============================================
// СООБЩЕНИЯ ЧАТА
// ============================================
let currentChatId = null;
let messagesInterval = null;

async function loadChatMessages(chatId) {
    currentChatId = chatId;
    
    try {
        const response = await fetch(`/api/chats/${chatId}/messages?telegramId=${currentUser.telegram_id}`);
        const data = await response.json();
        
        const chatHeader = document.getElementById('chat-header-name');
        if (chatHeader) chatHeader.textContent = data.companionName;
        
        const chatListing = document.getElementById('chat-listing-info');
        if (chatListing) {
            chatListing.innerHTML = `
                <a href="listing.html?id=${data.chat.listing_id}" style="text-decoration: none; color: inherit;">
                     ${data.chat.listing_title} • ${formatPrice(data.chat.listing_price)}
                </a>
            `;
        }
        
        renderMessages(data.messages);
        
        if (messagesInterval) clearInterval(messagesInterval);
        messagesInterval = setInterval(() => refreshMessages(chatId), 3000);
        
    } catch (error) {
        console.error('Ошибка загрузки сообщений:', error);
    }
}

async function refreshMessages(chatId) {
    try {
        const response = await fetch(`/api/chats/${chatId}/messages?telegramId=${currentUser.telegram_id}`);
        const data = await response.json();
        renderMessages(data.messages);
    } catch (error) {
        console.error('Ошибка обновления:', error);
    }
}

function renderMessages(messages) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    if (messages.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <div class="empty-icon">💬</div>
                <div class="empty-title">Начните общение</div>
                <div class="empty-text">Напишите первое сообщение</div>
            </div>
        `;
        return;
    }
    
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    
    container.innerHTML = messages.map(msg => {
        const isMe = msg.sender_id === currentUser.telegram_id;
        return `
            <div class="message ${isMe ? 'message-own' : 'message-other'}">
                <div class="message-bubble">
                    <div class="message-text">${msg.text}</div>
                    <div class="message-time">${formatTime(msg.created_at)}</div>
                </div>
            </div>
        `;
    }).join('');
    
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

document.addEventListener('submit', async (e) => {
    if (e.target.id === 'message-form') {
        e.preventDefault();
        
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        
        if (!text || !currentChatId) return;
        
        input.value = '';
        
        try {
            const response = await fetch(`/api/chats/${currentChatId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegramId: currentUser.telegram_id,
                    text: text
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                refreshMessages(currentChatId);
            }
        } catch (error) {
            console.error('Ошибка отправки:', error);
        }
    }
});

// ============================================
// ОТЗЫВЫ И РЕЙТИНГ
// ============================================
async function checkCanReview(toUserId, listingId) {
    try {
        const response = await fetch(`/api/reviews/can-review?fromUserId=${currentUser.telegram_id}&toUserId=${toUserId}&listingId=${listingId}`);
        const data = await response.json();
        return data.canReview;
    } catch (error) {
        console.error('Ошибка проверки:', error);
        return false;
    }
}

async function showReviewForm(toUserId, toUserName, listingId) {
    const canReview = await checkCanReview(toUserId, listingId);
    
    if (!canReview) {
        alert('❌ Вы не можете оставить отзыв по этой сделке');
        return;
    }
    
    const rating = prompt(`Оцените ${toUserName} (1-5 звёзд):`);
    if (!rating || rating < 1 || rating > 5) {
        alert('Рейтинг должен быть от 1 до 5');
        return;
    }
    
    const comment = prompt('Комментарий к отзыву (необязательно):') || '';
    
    try {
        const response = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fromUserId: currentUser.telegram_id,
                toUserId: toUserId,
                listingId: listingId,
                rating: parseInt(rating),
                comment: comment
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('✅ Отзыв добавлен! Спасибо за обратную связь.');
        } else {
            alert('❌ ' + (result.error || 'Ошибка добавления отзыва'));
        }
    } catch (error) {
        console.error('Ошибка отправки отзыва:', error);
        alert('❌ Ошибка соединения');
    }
}

async function loadReviews(userId) {
    try {
        const response = await fetch(`/api/reviews?userId=${userId}`);
        const reviews = await response.json();
        
        const container = document.getElementById('reviews-list');
        if (!container) return;
        
        if (reviews.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⭐</div>
                    <div class="empty-title">Пока нет отзывов</div>
                    <div class="empty-text">Будьте первым, кто оставит отзыв!</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = reviews.map(review => `
            <div class="review-card">
                <div class="review-header">
                    <div class="review-author">${review.from_user_name}</div>
                    <div class="review-rating">${'⭐'.repeat(review.rating)}</div>
                </div>
                <div class="review-listing">📦 ${review.listing_title}</div>
                ${review.comment ? `<div class="review-comment">${review.comment}</div>` : ''}
                <div class="review-date">${formatDate(review.created_at)}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Ошибка загрузки отзывов:', error);
    }
}

// ============================================
// ПОИСК
// ============================================
document.addEventListener('input', (e) => {
    if (e.target.id === 'search-input') {
        const searchQuery = e.target.value.trim();
        
        clearTimeout(window.searchTimeout);
        window.searchTimeout = setTimeout(() => {
            if (searchQuery.length >= 2) {
                loadListingsWithSearch(searchQuery);
            } else {
                loadListings();
            }
        }, 500);
    }
});

async function loadListingsWithSearch(query) {
    try {
        const response = await fetch(`/api/listings?city=${currentCity}&search=${encodeURIComponent(query)}`);
        const listings = await response.json();
        
        const container = document.getElementById('listings-container');
        if (!container) return;
        
        if (listings.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <div class="empty-title">Ничего не найдено</div>
                    <div class="empty-text">Попробуйте изменить запрос</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = `<div class="listings-grid">` + listings.map(listing => {
            const isFree = listing.price === 0;
            return `
                <a href="listing.html?id=${listing.id}" class="listing-card" style="position: relative; border: ${listing.is_vip ? '2px solid #ffd700' : (isFree ? '2px solid #4caf50' : 'none')}">
                    ${listing.is_vip ? '<div class="listing-vip">⭐ VIP</div>' : ''}
                    ${isFree ? '<div class="free-badge">БЕСПЛАТНО</div>' : ''}
                    <div class="listing-image">
                        ${listing.main_image 
                            ? `<img src="/uploads/${listing.main_image}" alt="${listing.title}">`
                            : listing.category_icon || '📦'
                        }
                    </div>
                    <div class="listing-info">
                        <div class="listing-title">${listing.title}</div>
                        <div class="listing-price" style="${isFree ? 'color: #4caf50; font-weight: 700;' : ''}">${isFree ? 'Отдам даром' : formatPrice(listing.price)}</div>
                        <div class="listing-meta">
                            <span>${listing.city}</span>
                            <span>${formatDate(listing.created_at)}</span>
                        </div>
                    </div>
                </a>
            `;
        }).join('') + `</div>`;
    } catch (error) {
        console.error('Ошибка поиска:', error);
    }
}

// ============================================
// ПЛАТНЫЕ УСЛУГИ
// ============================================
async function bumpListing(listingId) {
    if (!confirm('Поднять объявление в топ за 29 ₽?\n(В демо-режиме оплата не списывается)')) return;
    
    try {
        const response = await fetch(`/api/listings/${listingId}/bump`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId: currentUser.telegram_id })
        });
        
        const result = await response.json();
        if (result.success) {
            alert('✅ ' + result.message);
            loadMyListings();
        } else {
            alert('❌ ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('❌ Ошибка соединения');
    }
}

async function makeVipListing(listingId) {
    if (!confirm('Сделать объявление VIP за 49 ₽?\n(В демо-режиме оплата не списывается)')) return;
    
    try {
        const response = await fetch(`/api/listings/${listingId}/vip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId: currentUser.telegram_id })
        });
        
        const result = await response.json();
        if (result.success) {
            alert('✅ ' + result.message);
            loadMyListings();
        } else {
            alert('❌ ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('❌ Ошибка соединения');
    }
}