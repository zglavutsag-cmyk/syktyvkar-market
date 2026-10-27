const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Кэш статики на 1 час
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
    lastModified: true
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 1. БАЗА ДАННЫХ
// ==========================================
const dbPath = '/tmp/market.db';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        telegram_id TEXT PRIMARY KEY, username TEXT, first_name TEXT, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, category_id INTEGER NOT NULL,
        title TEXT NOT NULL, description TEXT, price INTEGER DEFAULT 0, 
        city TEXT DEFAULT 'Сыктывкар', address TEXT, 
        status TEXT DEFAULT 'pending', 
        views INTEGER DEFAULT 0, is_vip INTEGER DEFAULT 0, is_business INTEGER DEFAULT 0, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL, 
        filename TEXT NOT NULL, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT, buyer_id TEXT NOT NULL, 
        seller_id TEXT NOT NULL, listing_id INTEGER NOT NULL, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, 
        sender_id TEXT NOT NULL, text TEXT NOT NULL, is_read INTEGER DEFAULT 0, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, 
        type TEXT NOT NULL, message TEXT NOT NULL, is_read INTEGER DEFAULT 0, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS favorites (
        user_id TEXT NOT NULL, listing_id INTEGER NOT NULL, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
        PRIMARY KEY(user_id, listing_id)
    );
    CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT, from_user_id TEXT NOT NULL, 
        to_user_id TEXT NOT NULL, listing_id INTEGER NOT NULL, 
        rating INTEGER NOT NULL, comment TEXT, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS business_profiles (
        user_id TEXT PRIMARY KEY, business_name TEXT NOT NULL, 
        logo_filename TEXT, description TEXT, phone TEXT, address TEXT, 
        website TEXT, category TEXT, rating REAL DEFAULT 5.0, 
        total_reviews INTEGER DEFAULT 0, is_premium INTEGER DEFAULT 0, 
        premium_until DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Индексы
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
    CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category_id);
    CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id);
    CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city);
    CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_images_listing ON images(listing_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_chats_buyer ON chats(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_chats_seller ON chats(seller_id);
`);

// Категории по умолчанию
const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
if (catCount === 0) {
    db.exec(`INSERT INTO categories (name, icon) VALUES 
        ('Недвижимость', '🏠'), ('Транспорт', '🚗'), ('Работа', '💼'), 
        ('Услуги', '🛠️'), ('Личные вещи', '👕'), ('Для дома', '🪑'), 
        ('Электроника', '📱'), ('Хобби', '🎸'), ('Животные', '🐾'), 
        ('Даром', '🎁')`);
}

function getOrCreateUser(telegramId, username, firstName) {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) {
        db.prepare('INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)')
          .run(telegramId, username || 'user', firstName || 'Пользователь');
    }
}

// Загрузка фото
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ==========================================
// 2. УВЕДОМЛЕНИЯ В MAX
// ==========================================
async function sendMaxNotification(telegramId, text) {
    const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN || 'ТВОЙ_ТОКЕН_БОТА_MAX';
    const MAX_API_URL = `https://botapi.max.ru/v1/${MAX_BOT_TOKEN}/sendMessage`;

    try {
        await fetch(MAX_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: telegramId, text: text, parse_mode: 'HTML' })
        });
    } catch (error) {
        console.error('❌ Ошибка отправки в MAX:', error.message);
    }
}

// ==========================================
// 3. КАТЕГОРИИ
// ==========================================
app.get('/api/categories', (req, res) => {
    res.json(db.prepare('SELECT * FROM categories').all());
});

// ==========================================
// 4. ОБЪЯВЛЕНИЯ (МОДЕРАЦИЯ)
// ==========================================

// Публичная лента — только одобренные
app.get('/api/listings', (req, res) => {
    const { city, category, search, limit } = req.query;
    let query = `SELECT l.*, c.name as category_name, c.icon as category_icon, 
        (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image 
        FROM listings l LEFT JOIN categories c ON l.category_id = c.id 
        WHERE l.status = 'active'`;
    const params = [];
    if (city) { query += ' AND l.city = ?'; params.push(city); }
    if (category) { query += ' AND l.category_id = ?'; params.push(category); }
    if (search) { query += ' AND l.title LIKE ?'; params.push(`%${search}%`); }
    query += ' ORDER BY l.is_vip DESC, l.created_at DESC LIMIT ?';
    params.push(parseInt(limit) || 20);
    res.json(db.prepare(query).all(...params));
});

// Бесплатные — только одобренные
app.get('/api/free-stuff', (req, res) => {
    const { city, search } = req.query;
    let query = `SELECT l.*, c.name as category_name, c.icon as category_icon, 
        (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image 
        FROM listings l LEFT JOIN categories c ON l.category_id = c.id 
        WHERE l.status = 'active' AND l.price = 0`;
    const params = [];
    if (city) { query += ' AND l.city = ?'; params.push(city); }
    if (search) { query += ' AND l.title LIKE ?'; params.push(`%${search}%`); }
    query += ' ORDER BY l.created_at DESC';
    res.json(db.prepare(query).all(...params));
});

// Создание объявления (статус pending — на модерации!)
app.post('/api/listings', upload.array('images', 5), (req, res) => {
    const { telegramId, categoryId, title, description, price, city, address, isBusiness, username, firstName } = req.body;
    if (!telegramId || !categoryId || !title) return res.status(400).json({ error: 'Заполните обязательные поля' });
    
    getOrCreateUser(telegramId, username, firstName);
    
    // ВАЖНО: статус 'pending' — объявление ждёт модерации!
    const result = db.prepare(`
        INSERT INTO listings (user_id, category_id, title, description, price, city, address, is_business, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(telegramId, categoryId, title, description, price || 0, city || 'Сыктывкар', address, isBusiness === '1' ? 1 : 0);
    
    const listingId = result.lastInsertRowid;
    if (req.files && req.files.length > 0) {
        const insertImg = db.prepare('INSERT INTO images (listing_id, filename, sort_order) VALUES (?, ?, ?)');
        req.files.forEach((file, index) => insertImg.run(listingId, file.filename, index));
    }
    
    // Уведомление админу о новом объявлении на модерации
    const adminId = 'max_219641344';
    db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
        .run(adminId, 'moderation', `Новое объявление на модерации: "${title}"`);
    
    res.json({ success: true, listingId, status: 'pending', message: 'Объявление отправлено на модерацию' });
});

// Одно объявление (можно смотреть и pending, если ты автор)
app.get('/api/listings/:id', (req, res) => {
    db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(req.params.id);
    const listing = db.prepare(`
        SELECT l.*, u.username, u.first_name, u.telegram_id as seller_id 
        FROM listings l LEFT JOIN users u ON l.user_id = u.telegram_id 
        WHERE l.id = ?
    `).get(req.params.id);
    
    if (!listing) return res.status(404).json({ error: 'Не найдено' });
    listing.images = db.prepare('SELECT * FROM images WHERE listing_id = ? ORDER BY sort_order').all(req.params.id);
    res.json(listing);
});

// Мои объявления (все статусы, чтобы видеть pending)
app.get('/api/my-listings', (req, res) => {
    const { telegramId } = req.query;
    const query = `SELECT l.*, c.icon as category_icon, 
        (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image 
        FROM listings l LEFT JOIN categories c ON l.category_id = c.id 
        WHERE l.user_id = ? ORDER BY l.created_at DESC`;
    res.json(db.prepare(query).all(telegramId));
});

app.delete('/api/listings/:id', (req, res) => {
    const { telegramId } = req.body;
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
    if (listing && listing.user_id === telegramId) {
        db.prepare('DELETE FROM listings WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } else {
        res.status(403).json({ error: 'Нет прав' });
    }
});

// ==========================================
// 5. ЧАТЫ И СООБЩЕНИЯ
// ==========================================
app.post('/api/chats', (req, res) => {
    const { buyerId, sellerId, listingId } = req.body;
    if (!buyerId || !sellerId || !listingId) {
        return res.status(400).json({ error: 'Не все поля заполнены' });
    }
    
    let chat = db.prepare('SELECT id FROM chats WHERE buyer_id = ? AND seller_id = ? AND listing_id = ?')
        .get(buyerId, sellerId, listingId);
    
    if (!chat) {
        const result = db.prepare('INSERT INTO chats (buyer_id, seller_id, listing_id) VALUES (?, ?, ?)')
            .run(buyerId, sellerId, listingId);
        chat = { id: result.lastInsertRowid };
    }
    res.json({ chatId: chat.id });
});

app.get('/api/chats', (req, res) => {
    const telegramId = req.query.telegramId;
    if (!telegramId) return res.json([]);
    
    const query = `SELECT c.id as chat_id, c.listing_id, l.title as listing_title, 
        CASE WHEN c.buyer_id = ? THEN u2.first_name ELSE u1.first_name END as companion_name,
        (SELECT text FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND sender_id != ? AND is_read = 0) as unread_count
        FROM chats c
        JOIN listings l ON c.listing_id = l.id
        JOIN users u1 ON c.buyer_id = u1.telegram_id
        JOIN users u2 ON c.seller_id = u2.telegram_id
        WHERE c.buyer_id = ? OR c.seller_id = ?
        ORDER BY c.created_at DESC`;
    res.json(db.prepare(query).all(telegramId, telegramId, telegramId, telegramId));
});

app.get('/api/chats/:id/messages', (req, res) => {
    const chatId = req.params.id;
    const telegramId = req.query.telegramId;
    
    db.prepare('UPDATE messages SET is_read = 1 WHERE chat_id = ? AND sender_id != ?').run(chatId, telegramId);
    
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    
    const messages = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(chatId);
    const companionId = chat.buyer_id === telegramId ? chat.seller_id : chat.buyer_id;
    const companion = db.prepare('SELECT first_name FROM users WHERE telegram_id = ?').get(companionId);
    
    res.json({ 
        chat: chat, 
        messages: messages, 
        companionName: companion ? companion.first_name : 'Пользователь' 
    });
});

app.post('/api/chats/:id/messages', async (req, res) => {
    const chatId = req.params.id;
    const { telegramId, text } = req.body;
    
    if (!telegramId || !text) {
        return res.status(400).json({ error: 'Не все поля заполнены' });
    }
    
    db.prepare('INSERT INTO messages (chat_id, sender_id, text) VALUES (?, ?, ?)').run(chatId, telegramId, text);
    
    const chat = db.prepare('SELECT buyer_id, seller_id, listing_id FROM chats WHERE id = ?').get(chatId);
    const receiverId = chat.buyer_id === telegramId ? chat.seller_id : chat.buyer_id;
    const listing = db.prepare('SELECT title FROM listings WHERE id = ?').get(chat.listing_id);
    
    const notifText = `Новое сообщение по объявлению "${listing?.title || 'товару'}": "${text.substring(0, 50)}..."`;
    db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)').run(receiverId, 'message', notifText);
    
    sendMaxNotification(receiverId, `🔔 <b>Сыктывкар Барахолка</b>\n\nНовое сообщение по объявлению "${listing?.title || 'товару'}":\n"${text.substring(0, 100)}..."`).catch(e => console.error(e));
    
    res.json({ success: true });
});

app.get('/api/unread-count', (req, res) => {
    const { telegramId } = req.query;
    if (!telegramId) return res.json({ count: 0 });
    
    const result = db.prepare(`
        SELECT SUM(CASE WHEN sender_id != ? AND is_read = 0 THEN 1 ELSE 0 END) as count 
        FROM messages m 
        JOIN chats c ON m.chat_id = c.id 
        WHERE c.buyer_id = ? OR c.seller_id = ?
    `).get(telegramId, telegramId, telegramId);
    
    res.json({ count: result?.count || 0 });
});

// ==========================================
// 6. УВЕДОМЛЕНИЯ
// ==========================================
app.get('/api/notifications', (req, res) => {
    const { userId } = req.query;
    const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(userId)?.count || 0;
    const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(userId);
    res.json({ unreadCount, notifications });
});

app.post('/api/notifications', async (req, res) => {
    const { userId, type, message, sendToBot } = req.body;
    db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)').run(userId, type, message);
    if (sendToBot) {
        await sendMaxNotification(userId, `🔔 <b>Сыктывкар Барахолка</b>\n\n${message}`);
    }
    res.json({ success: true });
});

app.put('/api/notifications/:id/read', (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.put('/api/notifications/read-all', (req, res) => {
    const { userId } = req.body;
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
    res.json({ success: true });
});

// ==========================================
// 7. ИЗБРАННОЕ
// ==========================================
app.post('/api/favorites', (req, res) => {
    const { telegramId, listingId } = req.body;
    try {
        db.prepare('INSERT INTO favorites (user_id, listing_id) VALUES (?, ?)').run(telegramId, listingId);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: 'Уже в избранном' });
    }
});

app.get('/api/favorites', (req, res) => {
    const { telegramId } = req.query;
    const query = `SELECT l.*, c.icon as category_icon,
        (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image
        FROM listings l JOIN favorites f ON l.id = f.listing_id 
        LEFT JOIN categories c ON l.category_id = c.id
        WHERE f.user_id = ? ORDER BY f.created_at DESC`;
    res.json(db.prepare(query).all(telegramId));
});

// ==========================================
// 8. ОТЗЫВЫ
// ==========================================
app.post('/api/reviews', (req, res) => {
    const { fromUserId, toUserId, listingId, rating, comment } = req.body;
    db.prepare('INSERT INTO reviews (from_user_id, to_user_id, listing_id, rating, comment) VALUES (?, ?, ?, ?, ?)')
        .run(fromUserId, toUserId, listingId, rating, comment);
    
    const avg = db.prepare('SELECT COALESCE(AVG(rating), 5.0) as avg, COUNT(*) as count FROM reviews WHERE to_user_id = ?').get(toUserId);
    db.prepare('UPDATE business_profiles SET rating = ?, total_reviews = ? WHERE user_id = ?').run(avg.avg, avg.count, toUserId);
    
    const notifText = `Вам оставили отзыв с оценкой ${rating}/5!`;
    db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)').run(toUserId, 'review', notifText);
    sendMaxNotification(toUserId, `🔔 <b>Сыктывкар Барахолка</b>\n\nВам оставили новый отзыв с оценкой ${rating}/5!`).catch(e => console.error(e));
    
    res.json({ success: true });
});

app.get('/api/reviews', (req, res) => {
    const { userId } = req.query;
    const reviews = db.prepare(`
        SELECT r.*, u.first_name as from_user_name, l.title as listing_title 
        FROM reviews r 
        JOIN users u ON r.from_user_id = u.telegram_id 
        JOIN listings l ON r.listing_id = l.id 
        WHERE r.to_user_id = ? ORDER BY r.created_at DESC
    `).all(userId);
    res.json(reviews);
});

app.get('/api/reviews/can-review', (req, res) => {
    const { fromUserId, toUserId, listingId } = req.query;
    const hasBought = db.prepare('SELECT 1 FROM chats WHERE listing_id = ? AND (buyer_id = ? OR seller_id = ?)').get(listingId, fromUserId, fromUserId);
    const alreadyReviewed = db.prepare('SELECT 1 FROM reviews WHERE from_user_id = ? AND to_user_id = ? AND listing_id = ?').get(fromUserId, toUserId, listingId);
    res.json({ canReview: !!hasBought && !alreadyReviewed });
});

// ==========================================
// 9. БИЗНЕС-ПРОФИЛИ
// ==========================================
app.post('/api/business/profile', upload.single('logo'), (req, res) => {
    const { userId, businessName, description, phone, address, website, category, username, firstName } = req.body;
    if (!userId || !businessName) return res.status(400).json({ error: 'Заполните обязательные поля' });
    
    getOrCreateUser(userId, username, firstName);
    const logo = req.file ? req.file.filename : null;
    
    const existing = db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(userId);
    if (existing) {
        db.prepare(`UPDATE business_profiles SET business_name=?, description=?, phone=?, address=?, website=?, category=?, logo_filename=COALESCE(?, logo_filename) WHERE user_id=?`)
            .run(businessName, description, phone, address, website, category, logo, userId);
    } else {
        db.prepare(`INSERT INTO business_profiles (user_id, business_name, logo_filename, description, phone, address, website, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(userId, businessName, logo, description, phone, address, website, category);
    }
    res.json({ success: true });
});

app.get('/api/business/profile/:userId', (req, res) => {
    const profile = db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.params.userId);
    if (!profile) return res.status(404).json({ error: 'Профиль не найден' });
    res.json(profile);
});

app.get('/api/business/listings/:userId', (req, res) => {
    const query = `SELECT l.*, c.name as category_name, c.icon as category_icon,
        (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image
        FROM listings l LEFT JOIN categories c ON l.category_id = c.id
        WHERE l.user_id = ? AND l.is_business = 1 AND l.status = 'active' ORDER BY l.created_at DESC`;
    res.json(db.prepare(query).all(req.params.userId));
});

// ==========================================
// 10. АДМИН-ПАНЕЛЬ API (С МОДЕРАЦИЕЙ)
// ==========================================
app.get('/api/admin/stats', (req, res) => {
    res.json({
        totalListings: db.prepare('SELECT COUNT(*) as count FROM listings').get().count,
        activeListings: db.prepare("SELECT COUNT(*) as count FROM listings WHERE status = 'active'").get().count,
        pendingListings: db.prepare("SELECT COUNT(*) as count FROM listings WHERE status = 'pending'").get().count,
        rejectedListings: db.prepare("SELECT COUNT(*) as count FROM listings WHERE status = 'rejected'").get().count,
        totalUsers: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
        totalCategories: db.prepare('SELECT COUNT(*) as count FROM categories').get().count
    });
});

// Объявления на модерации (pending)
app.get('/api/admin/pending', (req, res) => {
    const query = `SELECT l.*, c.name as category_name, u.first_name as user_name,
        (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image
        FROM listings l 
        LEFT JOIN categories c ON l.category_id = c.id 
        LEFT JOIN users u ON l.user_id = u.telegram_id
        WHERE l.status = 'pending'
        ORDER BY l.created_at DESC`;
    res.json(db.prepare(query).all());
});

// Все объявления админу
app.get('/api/admin/listings', (req, res) => {
    const query = `SELECT l.*, c.name as category_name, u.first_name as user_name,
        (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image
        FROM listings l 
        LEFT JOIN categories c ON l.category_id = c.id 
        LEFT JOIN users u ON l.user_id = u.telegram_id
        ORDER BY l.created_at DESC`;
    res.json(db.prepare(query).all());
});

// ОДОБРИТЬ объявление (модерация)
app.put('/api/admin/listings/:id/approve', (req, res) => {
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
    if (listing) {
        db.prepare("UPDATE listings SET status = 'active' WHERE id = ?").run(req.params.id);
        
        // Уведомление автору
        const notifText = `✅ Ваше объявление "${listing.title}" одобрено и опубликовано!`;
        db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
            .run(listing.user_id, 'approved', notifText);
    }
    res.json({ success: true });
});

// ОТКЛОНИТЬ объявление
app.put('/api/admin/listings/:id/reject', (req, res) => {
    const { reason } = req.body;
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
    if (listing) {
        db.prepare("UPDATE listings SET status = 'rejected' WHERE id = ?").run(req.params.id);
        
        const reasonText = reason ? `\nПричина: ${reason}` : '';
        const notifText = `❌ Ваше объявление "${listing.title}" отклонено.${reasonText}`;
        db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
            .run(listing.user_id, 'rejected', notifText);
    }
    res.json({ success: true });
});

// Изменить статус вручную
app.put('/api/admin/listings/:id/status', (req, res) => {
    db.prepare('UPDATE listings SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
    res.json({ success: true });
});

app.delete('/api/admin/listings/:id', (req, res) => {
    db.prepare('DELETE FROM listings WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.get('/api/admin/users', (req, res) => {
    res.json(db.prepare('SELECT * FROM users ORDER BY created_at DESC').all());
});

app.post('/api/admin/users/:userId/block', (req, res) => {
    db.prepare("UPDATE listings SET status = 'hidden' WHERE user_id = ?").run(req.params.userId);
    res.json({ success: true });
});

app.post('/api/admin/categories', (req, res) => {
    const { name, icon } = req.body;
    db.prepare('INSERT INTO categories (name, icon) VALUES (?, ?)').run(name, icon);
    res.json({ success: true });
});

app.delete('/api/admin/categories/:id', (req, res) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ==========================================
// 11. ЗАПУСК
// ==========================================
app.listen(PORT, HOST, () => {
    console.log(`🏙️ Маркетплейс Сыктывкар запущен на http://${HOST}:${PORT}`);
});
