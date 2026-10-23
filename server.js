require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// НАСТРОЙКИ
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// ============================================
// НАСТРОЙКА ЗАГРУЗКИ ФОТО (Multer)
// ============================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public/uploads'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Только изображения (JPG, PNG, WEBP)'));
        }
    }
});

// ============================================
// ПОЛУЧЕНИЕ ИЛИ СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ
// ============================================
function getOrCreateUser(telegramId, username, firstName) {
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) {
        db.prepare('INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)')
            .run(telegramId, username, firstName);
        user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    }
    return user;
}

// ============================================
// API: ПОЛУЧИТЬ ПРОФИЛЬ
// ============================================
app.post('/api/profile', (req, res) => {
    const { telegramId, username, firstName } = req.body;
    
    if (!telegramId) {
        return res.status(400).json({ error: 'Не указан telegramId' });
    }

    const user = getOrCreateUser(telegramId, username, firstName);
    res.json({
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        city: user.city,
        rating: user.rating,
        total_reviews: user.total_reviews
    });
});

// ============================================
// API: ПОЛУЧИТЬ КАТЕГОРИИ
// ============================================
app.get('/api/categories', (req, res) => {
    const categories = db.prepare('SELECT * FROM categories ORDER BY id').all();
    res.json(categories);
});

// ============================================
// API: ПОЛУЧИТЬ СПИСОК ОБЪЯВЛЕНИЙ
// ============================================
app.get('/api/listings', (req, res) => {
    const { category, city, search, limit = 50, offset = 0 } = req.query;
    
    let query = `
        SELECT l.*, c.name as category_name, c.icon as category_icon,
               (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image
        FROM listings l
        LEFT JOIN categories c ON l.category_id = c.id
        WHERE l.status = 'active'
    `;
    
    const params = [];
    
    if (category) {
        query += ' AND l.category_id = ?';
        params.push(category);
    }
    
    if (city) {
        query += ' AND l.city = ?';
        params.push(city);
    }
    
    if (search) {
        query += ' AND (l.title LIKE ? OR l.description LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY l.is_vip DESC, l.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const listings = db.prepare(query).all(...params);
    res.json(listings);
});

// ============================================
// API: ПОЛУЧИТЬ ОДНО ОБЪЯВЛЕНИЕ
// ============================================
app.get('/api/listings/:id', (req, res) => {
    const { id } = req.params;
    
    const listing = db.prepare(`
        SELECT l.*, c.name as category_name, c.icon as category_icon,
               u.username, u.first_name, u.rating, u.telegram_id as seller_id
        FROM listings l
        LEFT JOIN categories c ON l.category_id = c.id
        LEFT JOIN users u ON l.user_id = u.telegram_id
        WHERE l.id = ?
    `).get(id);
    
    if (!listing) {
        return res.status(404).json({ error: 'Объявление не найдено' });
    }
    
    db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(id);
    
    const images = db.prepare('SELECT * FROM images WHERE listing_id = ? ORDER BY sort_order').all(id);
    
    res.json({ ...listing, images });
});

// ============================================
// API: СОЗДАТЬ ОБЪЯВЛЕНИЕ
// ============================================
app.post('/api/listings', upload.array('images', 5), (req, res) => {
    const { telegramId, categoryId, title, description, price, city, address, isBusiness } = req.body;
    
    if (!telegramId || !categoryId || !title) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }
    
    getOrCreateUser(telegramId, req.body.username, req.body.firstName);
    
    const result = db.prepare(`
        INSERT INTO listings (user_id, category_id, title, description, price, city, address, is_business)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(telegramId, categoryId, title, description, price || 0, city || 'Сыктывкар', address, isBusiness === '1' ? 1 : 0);
    
    const listingId = result.lastInsertRowid;
    
    if (req.files && req.files.length > 0) {
        const insertImage = db.prepare('INSERT INTO images (listing_id, filename, sort_order) VALUES (?, ?, ?)');
        req.files.forEach((file, index) => {
            insertImage.run(listingId, file.filename, index);
        });
    }
    
    res.json({ success: true, listingId });
});
// ============================================
// API: УДАЛИТЬ ОБЪЯВЛЕНИЕ
// ============================================
app.delete('/api/listings/:id', (req, res) => {
    const { id } = req.params;
    const { telegramId } = req.body;
    
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
    
    if (!listing) {
        return res.status(404).json({ error: 'Объявление не найдено' });
    }
    
    if (listing.user_id !== telegramId) {
        return res.status(403).json({ error: 'Нет прав на удаление' });
    }
    
    db.prepare('UPDATE listings SET status = ? WHERE id = ?').run('deleted', id);
    res.json({ success: true });
});

// ============================================
// API: МОИ ОБЪЯВЛЕНИЯ
// ============================================
app.get('/api/my-listings', (req, res) => {
    const { telegramId } = req.query;
    
    if (!telegramId) {
        return res.status(400).json({ error: 'Не указан telegramId' });
    }
    
    const listings = db.prepare(`
        SELECT l.*, c.name as category_name, c.icon as category_icon,
               (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image
        FROM listings l
        LEFT JOIN categories c ON l.category_id = c.id
        WHERE l.user_id = ? AND l.status = 'active'
        ORDER BY l.created_at DESC
    `).all(telegramId);
    
    res.json(listings);
});

// ============================================
// API: ИЗБРАННОЕ
// ============================================
app.post('/api/favorites', (req, res) => {
    const { telegramId, listingId } = req.body;
    
    try {
        db.prepare('INSERT INTO favorites (user_id, listing_id) VALUES (?, ?)').run(telegramId, listingId);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: 'Уже в избранном' });
    }
});

app.delete('/api/favorites', (req, res) => {
    const { telegramId, listingId } = req.body;
    
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND listing_id = ?').run(telegramId, listingId);
    res.json({ success: true });
});

app.get('/api/favorites', (req, res) => {
    const { telegramId } = req.query;
    
    const favorites = db.prepare(`
        SELECT l.*, c.name as category_name, c.icon as category_icon,
               (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image
        FROM favorites f
        JOIN listings l ON f.listing_id = l.id
        LEFT JOIN categories c ON l.category_id = c.id
        WHERE f.user_id = ? AND l.status = 'active'
        ORDER BY f.created_at DESC
    `).all(telegramId);
    
    res.json(favorites);
});

// ============================================
// API: ПОДНЯТЬ ОБЪЯВЛЕНИЕ В ТОП (МОНЕТИЗАЦИЯ)
// ============================================
app.post('/api/listings/:id/bump', (req, res) => {
    const { id } = req.params;
    const { telegramId } = req.body;
    
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
    
    if (!listing) return res.status(404).json({ error: 'Объявление не найдено' });
    if (listing.user_id !== telegramId) return res.status(403).json({ error: 'Нет прав' });

    db.prepare('UPDATE listings SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    
    res.json({ success: true, message: 'Объявление поднято в топ!' });
});

// ============================================
// API: СДЕЛАТЬ ОБЪЯВЛЕНИЕ VIP (МОНЕТИЗАЦИЯ)
// ============================================
app.post('/api/listings/:id/vip', (req, res) => {
    const { id } = req.params;
    const { telegramId } = req.body;
    
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
    
    if (!listing) return res.status(404).json({ error: 'Объявление не найдено' });
    if (listing.user_id !== telegramId) return res.status(403).json({ error: 'Нет прав' });

    db.prepare('UPDATE listings SET is_vip = 1 WHERE id = ?').run(id);
    
    res.json({ success: true, message: 'Объявление теперь VIP!' });
});

// ============================================
// API: СОЗДАТЬ ИЛИ ПОЛУЧИТЬ ЧАТ
// ============================================
app.post('/api/chats', (req, res) => {
    const { buyerId, sellerId, listingId } = req.body;
    
    if (!buyerId || !sellerId || !listingId) {
        return res.status(400).json({ error: 'Не хватает данных' });
    }
    
    if (buyerId === sellerId) {
        return res.status(400).json({ error: 'Нельзя написать самому себе' });
    }
    
    let chat = db.prepare(`
        SELECT * FROM chats 
        WHERE buyer_id = ? AND seller_id = ? AND listing_id = ?
    `).get(buyerId, sellerId, listingId);
    
    if (!chat) {
        const result = db.prepare(`
            INSERT INTO chats (buyer_id, seller_id, listing_id)
            VALUES (?, ?, ?)
        `).run(buyerId, sellerId, listingId);
        
        chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(result.lastInsertRowid);
    }
    
    res.json({ chatId: chat.id });
});

// ============================================
// API: ПОЛУЧИТЬ СПИСОК МОИХ ЧАТОВ
// ============================================
app.get('/api/chats', (req, res) => {
    const { telegramId } = req.query;
    
    if (!telegramId) {
        return res.status(400).json({ error: 'Не указан telegramId' });
    }
    
    const chats = db.prepare(`
        SELECT 
            c.id as chat_id,
            c.buyer_id,
            c.seller_id,
            c.listing_id,
            c.created_at as chat_created,
            l.title as listing_title,
            l.price as listing_price,
            (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as listing_image,
            CASE 
                WHEN c.buyer_id = ? THEN c.seller_id 
                ELSE c.buyer_id 
            END as companion_id,
            CASE 
                WHEN c.buyer_id = ? THEN (SELECT first_name FROM users WHERE telegram_id = c.seller_id)
                ELSE (SELECT first_name FROM users WHERE telegram_id = c.buyer_id)
            END as companion_name,
            (SELECT text FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
            (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
            (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND sender_id != ? AND is_read = 0) as unread_count
        FROM chats c
        JOIN listings l ON c.listing_id = l.id
        WHERE c.buyer_id = ? OR c.seller_id = ?
        ORDER BY last_message_time DESC, c.created_at DESC
    `).all(telegramId, telegramId, telegramId, telegramId, telegramId);
    
    res.json(chats);
});

// ============================================
// API: ПОЛУЧИТЬ СООБЩЕНИЯ ЧАТА
// ============================================
app.get('/api/chats/:id/messages', (req, res) => {
    const { id } = req.params;
    const { telegramId } = req.query;
    
    const chat = db.prepare(`
        SELECT c.*, l.title as listing_title, l.price as listing_price,
               (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as listing_image
        FROM chats c
        JOIN listings l ON c.listing_id = l.id
        WHERE c.id = ? AND (c.buyer_id = ? OR c.seller_id = ?)
    `).get(id, telegramId, telegramId);
    
    if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
    }
    
    const messages = db.prepare(`
        SELECT m.*, u.first_name as sender_name
        FROM messages m
        JOIN users u ON m.sender_id = u.telegram_id
        WHERE m.chat_id = ?
        ORDER BY m.created_at ASC
    `).all(id);
    
    db.prepare(`
        UPDATE messages SET is_read = 1 
        WHERE chat_id = ? AND sender_id != ?
    `).run(id, telegramId);
    
    const companionId = chat.buyer_id === telegramId ? chat.seller_id : chat.buyer_id;
    const companion = db.prepare('SELECT first_name FROM users WHERE telegram_id = ?').get(companionId);
    
    res.json({
        chat: chat,
        companionId: companionId,
        companionName: companion?.first_name || 'Пользователь',
        messages: messages
    });
});

// ============================================
// API: ОТПРАВИТЬ СООБЩЕНИЕ
// ============================================
app.post('/api/chats/:id/messages', (req, res) => {
    const { id } = req.params;
    const { telegramId, text } = req.body;
    
    if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: 'Пустое сообщение' });
    }
    
    const chat = db.prepare(`
        SELECT * FROM chats 
        WHERE id = ? AND (buyer_id = ? OR seller_id = ?)
    `).get(id, telegramId, telegramId);
    
    if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
    }
    
    const result = db.prepare(`
        INSERT INTO messages (chat_id, sender_id, text)
        VALUES (?, ?, ?)
    `).run(id, telegramId, text.trim());
    
    const message = db.prepare(`
        SELECT m.*, u.first_name as sender_name
        FROM messages m
        JOIN users u ON m.sender_id = u.telegram_id
        WHERE m.id = ?
    `).get(result.lastInsertRowid);
    
    res.json({ success: true, message });
});

// ============================================
// API: ПОЛУЧИТЬ ОБЩЕЕ КОЛИЧЕСТВО НЕПРОЧИТАННЫХ
// ============================================
app.get('/api/unread-count', (req, res) => {
    const { telegramId } = req.query;
    
    const result = db.prepare(`
        SELECT COUNT(*) as count
        FROM messages m
        JOIN chats c ON m.chat_id = c.id
        WHERE m.sender_id != ? AND m.is_read = 0
        AND (c.buyer_id = ? OR c.seller_id = ?)
    `).get(telegramId, telegramId, telegramId);
    
    res.json({ count: result.count });
});
// ============================================
// API: СОЗДАТЬ ОТЗЫВ
// ============================================
app.post('/api/reviews', (req, res) => {
    const { fromUserId, toUserId, listingId, rating, comment } = req.body;
    
    if (!fromUserId || !toUserId || !listingId || !rating) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }
    
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Рейтинг должен быть от 1 до 5' });
    }
    
    if (fromUserId === toUserId) {
        return res.status(400).json({ error: 'Нельзя оставить отзыв самому себе' });
    }
    
    // Проверяем, что пользователь участвовал в сделке (был чат по этому объявлению)
    const chat = db.prepare(`
        SELECT * FROM chats 
        WHERE listing_id = ? 
        AND ((buyer_id = ? AND seller_id = ?) OR (buyer_id = ? AND seller_id = ?))
    `).get(listingId, fromUserId, toUserId, toUserId, fromUserId);
    
    if (!chat) {
        return res.status(403).json({ error: 'Вы не можете оставить отзыв — нет истории общения по этому объявлению' });
    }
    
    try {
        db.prepare(`
            INSERT INTO reviews (from_user_id, to_user_id, listing_id, rating, comment)
            VALUES (?, ?, ?, ?, ?)
        `).run(fromUserId, toUserId, listingId, rating, comment);
        
        // Обновляем средний рейтинг пользователя
        const avgRating = db.prepare(`
            SELECT AVG(rating) as avg_rating, COUNT(*) as count
            FROM reviews
            WHERE to_user_id = ?
        `).get(toUserId);
        
        db.prepare(`
            UPDATE users 
            SET rating = ?, total_reviews = ?
            WHERE telegram_id = ?
        `).run(avgRating.avg_rating || 5, avgRating.count, toUserId);
        
        res.json({ success: true, message: 'Отзыв добавлен!' });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Вы уже оставили отзыв по этой сделке' });
        }
        throw error;
    }
});

// ============================================
// API: ПОЛУЧИТЬ ОТЗЫВЫ О ПОЛЬЗОВАТЕЛЕ
// ============================================
app.get('/api/reviews', (req, res) => {
    const { userId } = req.query;
    
    if (!userId) {
        return res.status(400).json({ error: 'Не указан userId' });
    }
    
    const reviews = db.prepare(`
        SELECT r.*, u.first_name as from_user_name, l.title as listing_title
        FROM reviews r
        JOIN users u ON r.from_user_id = u.telegram_id
        JOIN listings l ON r.listing_id = l.id
        WHERE r.to_user_id = ?
        ORDER BY r.created_at DESC
    `).all(userId);
    
    res.json(reviews);
});

// ============================================
// API: ПРОВЕРИТЬ, МОЖНО ЛИ ОСТАВИТЬ ОТЗЫВ
// ============================================
app.get('/api/reviews/can-review', (req, res) => {
    const { fromUserId, toUserId, listingId } = req.query;
    
    // Проверяем, есть ли чат
    const chat = db.prepare(`
        SELECT * FROM chats 
        WHERE listing_id = ? 
        AND ((buyer_id = ? AND seller_id = ?) OR (buyer_id = ? AND seller_id = ?))
    `).get(listingId, fromUserId, toUserId, toUserId, fromUserId);
    
    if (!chat) {
        return res.json({ canReview: false, reason: 'Нет истории общения' });
    }
    
    // Проверяем, не оставляли ли уже отзыв
    const existingReview = db.prepare(`
        SELECT * FROM reviews
        WHERE from_user_id = ? AND to_user_id = ? AND listing_id = ?
    `).get(fromUserId, toUserId, listingId);
    
    if (existingReview) {
        return res.json({ canReview: false, reason: 'Отзыв уже оставлен' });
    }
    
    res.json({ canReview: true });
});

// ============================================
// API: БИЗНЕС-ПРОФИЛИ
// ============================================
// Создать или обновить бизнес-профиль
app.post('/api/business/profile', upload.single('logo'), (req, res) => {
    const { userId, businessName, description, phone, address, website, category } = req.body;
    
    if (!userId || !businessName) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }
    
    // ВАЖНО: создаем пользователя, если его еще нет
    getOrCreateUser(userId, req.body.username || 'business_user', req.body.firstName || 'Бизнес');
    
    const logoFilename = req.file ? req.file.filename : null;
    
    // Проверяем, существует ли профиль
    const existing = db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(userId);
    
    if (existing) {
        // Обновляем
        db.prepare(`
            UPDATE business_profiles 
            SET business_name = ?, description = ?, phone = ?, address = ?, 
                website = ?, category = ?, updated_at = CURRENT_TIMESTAMP
            ${logoFilename ? ', logo_filename = ?' : ''}
            WHERE user_id = ?
        `).run(businessName, description, phone, address, website, category, 
           ...(logoFilename ? [logoFilename, userId] : [userId]));
    } else {
        // Создаём
        db.prepare(`
            INSERT INTO business_profiles (user_id, business_name, logo_filename, description, phone, address, website, category)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userId, businessName, logoFilename, description, phone, address, website, category);
    }
    
    res.json({ success: true });
});

// Получить бизнес-профиль
app.get('/api/business/profile/:userId', (req, res) => {
    const { userId } = req.params;
    
    const profile = db.prepare(`
        SELECT bp.*, u.first_name, u.rating, u.total_reviews,
               (SELECT COUNT(*) FROM listings WHERE user_id = bp.user_id AND status = 'active') as active_listings
        FROM business_profiles bp
        JOIN users u ON bp.user_id = u.telegram_id
        WHERE bp.user_id = ?
    `).get(userId);
    
    if (!profile) {
        return res.status(404).json({ error: 'Бизнес-профиль не найден' });
    }
    
    res.json(profile);
});

// Получить все бизнес-профили (витрина)
app.get('/api/business/list', (req, res) => {
    const { category, premium } = req.query;
    
    let query = `
        SELECT bp.*, u.first_name, u.rating,
               (SELECT COUNT(*) FROM listings WHERE user_id = bp.user_id AND status = 'active') as active_listings
        FROM business_profiles bp
        JOIN users u ON bp.user_id = u.telegram_id
        WHERE 1=1
    `;
    
    const params = [];
    
    if (category) {
        query += ' AND bp.category = ?';
        params.push(category);
    }
    
    if (premium === 'true') {
        query += ' AND bp.is_premium = 1 AND bp.premium_until > CURRENT_TIMESTAMP';
    }
    
    query += ' ORDER BY bp.is_premium DESC, bp.premium_until DESC, u.rating DESC';
    
    const profiles = db.prepare(query).all(...params);
    res.json(profiles);
});

// ============================================
// API: УСЛУГИ БИЗНЕСА
// ============================================

// Добавить услугу
app.post('/api/business/services', (req, res) => {
    const { businessId, name, description, price, duration } = req.body;
    
    if (!businessId || !name) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }
    
    db.prepare(`
        INSERT INTO business_services (business_id, name, description, price, duration_minutes)
        VALUES (?, ?, ?, ?, ?)
    `).run(businessId, name, description, price || 0, duration || 0);
    
    res.json({ success: true });
});

// Получить услуги бизнеса
app.get('/api/business/services/:businessId', (req, res) => {
    const { businessId } = req.params;
    
    const services = db.prepare(`
        SELECT * FROM business_services 
        WHERE business_id = ? 
        ORDER BY sort_order, id
    `).all(businessId);
    
    res.json(services);
});

// ============================================
// API: ПОДПИСКИ
// ============================================

// Активировать подписку
app.post('/api/subscription/activate', (req, res) => {
    const { userId, type, days, amount } = req.body;
    
    if (!userId || !type) {
        return res.status(400).json({ error: 'Неверные данные' });
    }
    
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (days || 30));
    
    // Обновляем бизнес-профиль
    db.prepare(`
        UPDATE business_profiles 
        SET is_premium = 1, premium_until = ?
        WHERE user_id = ?
    `).run(endDate.toISOString(), userId);
    
    // Создаём запись о подписке
    db.prepare(`
        INSERT INTO subscriptions (user_id, type, end_date, amount, status)
        VALUES (?, ?, ?, ?, 'active')
    `).run(userId, type, endDate.toISOString(), amount || 0);
    
    res.json({ success: true, endDate: endDate.toISOString() });
});

// Проверить статус подписки
app.get('/api/subscription/status/:userId', (req, res) => {
    const { userId } = req.params;
    
    const profile = db.prepare(`
        SELECT is_premium, premium_until FROM business_profiles WHERE user_id = ?
    `).get(userId);
    
    if (!profile) {
        return res.json({ isPremium: false });
    }
    
    const isPremium = profile.is_premium === 1 && new Date(profile.premium_until) > new Date();
    
    res.json({
        isPremium: isPremium,
        premiumUntil: isPremium ? profile.premium_until : null
    });
});

// ============================================
// API: ОТДАМ ДАРОМ (фильтр объявлений)
// ============================================
app.get('/api/free-stuff', (req, res) => {
    const { city } = req.query;
    
    let query = `
        SELECT l.*, c.name as category_name, c.icon as category_icon,
               u.first_name,
               (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image
        FROM listings l
        LEFT JOIN categories c ON l.category_id = c.id
        LEFT JOIN users u ON l.user_id = u.telegram_id
        WHERE l.price = 0 AND l.status = 'active'
    `;
    
    const params = [];
    
    if (city) {
        query += ' AND l.city = ?';
        params.push(city);
    }
    
    query += ' ORDER BY l.created_at DESC LIMIT 50';
    
    const listings = db.prepare(query).all(...params);
    res.json(listings);
});

// ============================================
// API: ПОЛУЧИТЬ ОБЪЯВЛЕНИЯ БИЗНЕСА
// ============================================
app.get('/api/business/listings/:userId', (req, res) => {
    const { userId } = req.params;
    
    const listings = db.prepare(`
        SELECT l.*, c.name as category_name, c.icon as category_icon,
               (SELECT filename FROM images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as main_image
        FROM listings l
        LEFT JOIN categories c ON l.category_id = c.id
        WHERE l.user_id = ? AND l.is_business = 1 AND l.status = 'active'
        ORDER BY l.created_at DESC
    `).all(userId);
    
    res.json(listings);
});
// ============================================
// ОБРАБОТКА ОШИБОК
// ============================================
app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: error.message || 'Ошибка сервера' });
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================
app.listen(PORT, () => {
    console.log(`🏙️ Маркетплейс Сыктывкар запущен на http://localhost:${PORT}`);
});