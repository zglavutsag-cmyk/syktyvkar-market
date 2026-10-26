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

// ==========================================
// БАЗА ДАННЫХ
// ==========================================
const dbPath = '/tmp/market.db';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (telegram_id TEXT PRIMARY KEY, username TEXT, first_name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS listings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, category_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT, price INTEGER DEFAULT 0, city TEXT DEFAULT 'Сыктывкар', address TEXT, status TEXT DEFAULT 'active', views INTEGER DEFAULT 0, is_vip INTEGER DEFAULT 0, is_business INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL, filename TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, listing_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, sender_id TEXT NOT NULL, text TEXT NOT NULL, is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, type TEXT NOT NULL, message TEXT NOT NULL, is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
`);

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
    CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
`);

const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
if (catCount === 0) {
    db.exec(`INSERT INTO categories (name, icon) VALUES 
        ('Недвижимость', '🏠'), ('Транспорт', '🚗'), ('Работа', '💼'), 
        ('Услуги', '️'), ('Личные вещи', ''), ('Для дома', '🪑'), 
        ('Электроника', '📱'), ('Хобби', '🎸'), ('Животные', '🐾'), ('Даром', '🎁')`);
}

function getOrCreateUser(telegramId, username, firstName) {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) {
        db.prepare('INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)').run(telegramId, username || 'user', firstName || 'Пользователь');
    }
}

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, uploadDir), filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname) }) });

// ==========================================
// API МАРШРУТЫ (ДО СТАТИКИ!)
// ==========================================

// Категории
app.get('/api/categories', (req, res) => {
    res.json(db.prepare('SELECT * FROM categories').all());
});

// Список объявлений
app.get('/api/listings', (req, res) => {
    const { city, category, search } = req.query;
    let query = `SELECT l.*, c.name as category_name, c.icon as category_icon, (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image FROM listings l LEFT JOIN categories c ON l.category_id = c.id WHERE l.status = 'active'`;
    const params = [];
    if (city) { query += ' AND l.city = ?'; params.push(city); }
    if (category) { query += ' AND l.category_id = ?'; params.push(category); }
    if (search) { query += ' AND l.title LIKE ?'; params.push(`%${search}%`); }
    query += ' ORDER BY l.is_vip DESC, l.created_at DESC LIMIT 50';
    res.json(db.prepare(query).all(...params));
});

// Одно объявление
app.get('/api/listings/:id', (req, res) => {
    try {
        db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(req.params.id);
        const listing = db.prepare(`SELECT l.*, u.username, u.first_name, u.telegram_id as seller_id FROM listings l LEFT JOIN users u ON l.user_id = u.telegram_id WHERE l.id = ?`).get(req.params.id);
        if (!listing) return res.status(404).json({ error: 'Не найдено' });
        listing.images = db.prepare('SELECT * FROM images WHERE listing_id = ? ORDER BY sort_order').all(req.params.id);
        res.json(listing);
    } catch (e) {
        console.error('Ошибка:', e);
        res.status(500).json({ error: 'Внутренняя ошибка' });
    }
});

// Мои объявления
app.get('/api/my-listings', (req, res) => {
    const query = `SELECT l.*, c.icon as category_icon, (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image FROM listings l LEFT JOIN categories c ON l.category_id = c.id WHERE l.user_id = ? ORDER BY l.created_at DESC`;
    res.json(db.prepare(query).all(req.query.telegramId));
});

// Создание объявления
app.post('/api/listings', upload.array('images', 5), (req, res) => {
    const { telegramId, categoryId, title, description, price, city, address, isBusiness, username, firstName } = req.body;
    if (!telegramId || !categoryId || !title) return res.status(400).json({ error: 'Заполните поля' });
    getOrCreateUser(telegramId, username, firstName);
    const result = db.prepare(`INSERT INTO listings (user_id, category_id, title, description, price, city, address, is_business) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(telegramId, categoryId, title, description, price || 0, city || 'Сыктывкар', address, isBusiness === '1' ? 1 : 0);
    if (req.files) {
        const insertImg = db.prepare('INSERT INTO images (listing_id, filename, sort_order) VALUES (?, ?, ?)');
        req.files.forEach((file, index) => insertImg.run(result.lastInsertRowid, file.filename, index));
    }
    res.json({ success: true, listingId: result.lastInsertRowid });
});

// Удалить объявление
app.delete('/api/listings/:id', (req, res) => {
    db.prepare('DELETE FROM listings WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// Уведомления
app.get('/api/notifications', (req, res) => {
    const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(req.query.userId)?.count || 0;
    const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.query.userId);
    res.json({ unreadCount, notifications });
});

app.put('/api/notifications/read-all', (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.body.userId);
    res.json({ success: true });
});

// Чаты
app.post('/api/chats', (req, res) => {
    let chat = db.prepare('SELECT id FROM chats WHERE buyer_id = ? AND seller_id = ? AND listing_id = ?').get(req.body.buyerId, req.body.sellerId, req.body.listingId);
    if (!chat) chat = { id: db.prepare('INSERT INTO chats (buyer_id, seller_id, listing_id) VALUES (?, ?, ?)').run(req.body.buyerId, req.body.sellerId, req.body.listingId).lastInsertRowid };
    res.json({ chatId: chat.id });
});

app.get('/api/chats', (req, res) => {
    const query = `SELECT c.id as chat_id, l.title as listing_title, CASE WHEN c.buyer_id = ? THEN u2.first_name ELSE u1.first_name END as companion_name, (SELECT text FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message FROM chats c JOIN listings l ON c.listing_id = l.id JOIN users u1 ON c.buyer_id = u1.telegram_id JOIN users u2 ON c.seller_id = u2.telegram_id WHERE c.buyer_id = ? OR c.seller_id = ? ORDER BY c.created_at DESC`;
    res.json(db.prepare(query).all(req.query.telegramId, req.query.telegramId, req.query.telegramId));
});

app.post('/api/chats/:id/messages', (req, res) => {
    const chatId = req.params.id;
    db.prepare('INSERT INTO messages (chat_id, sender_id, text) VALUES (?, ?, ?)').run(chatId, req.body.telegramId, req.body.text);
    const chat = db.prepare('SELECT buyer_id, seller_id, listing_id FROM chats WHERE id = ?').get(chatId);
    const receiverId = chat.buyer_id === req.body.telegramId ? chat.seller_id : chat.buyer_id;
    const listing = db.prepare('SELECT title FROM listings WHERE id = ?').get(chat.listing_id);
    const notifText = `Новое сообщение по объявлению "${listing?.title || 'товару'}"`;
    db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)').run(receiverId, 'message', notifText);
    res.json({ success: true });
});

app.get('/api/chats/:id/messages', (req, res) => {
    db.prepare('UPDATE messages SET is_read = 1 WHERE chat_id = ? AND sender_id != ?').run(req.params.id, req.query.telegramId);
    const messages = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(req.params.id);
    res.json({ messages });
});

// Избранное
app.post('/api/favorites', (req, res) => {
    try {
        db.prepare('INSERT INTO favorites (user_id, listing_id) VALUES (?, ?)').run(req.body.telegramId, req.body.listingId);
        res.json({ success: true });
    } catch (e) { res.json({ success: false, message: 'Уже в избранном' }); }
});

app.get('/api/favorites', (req, res) => {
    const query = `SELECT l.*, c.icon as category_icon, (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image FROM listings l JOIN favorites f ON l.id = f.listing_id LEFT JOIN categories c ON l.category_id = c.id WHERE f.user_id = ? ORDER BY f.created_at DESC`;
    res.json(db.prepare(query).all(req.query.telegramId));
});

// Админка
app.get('/api/admin/stats', (req, res) => {
    res.json({
        totalListings: db.prepare('SELECT COUNT(*) as count FROM listings').get().count,
        activeListings: db.prepare("SELECT COUNT(*) as count FROM listings WHERE status = 'active'").get().count,
        totalUsers: db.prepare('SELECT COUNT(*) as count FROM users').get().count
    });
});
app.get('/api/admin/listings', (req, res) => res.json(db.prepare('SELECT * FROM listings ORDER BY created_at DESC').all()));
app.put('/api/admin/listings/:id/status', (req, res) => { db.prepare('UPDATE listings SET status = ? WHERE id = ?').run(req.body.status, req.params.id); res.json({ success: true }); });
app.delete('/api/admin/listings/:id', (req, res) => { db.prepare('DELETE FROM listings WHERE id = ?').run(req.params.id); res.json({ success: true }); });

// ==========================================
// СТАТИКА И ГЛАВНАЯ (ПОСЛЕ API!)
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// ЗАПУСК
// ==========================================
app.listen(PORT, HOST, () => {
    console.log(`🏙️ Маркетплейс Сыктывкар запущен на http://${HOST}:${PORT}`);
});
