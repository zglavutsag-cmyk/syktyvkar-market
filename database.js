const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'market.db'));

// Включаем режим WAL для лучшей производительности
db.pragma('journal_mode = WAL');

// ============================================
// ТАБЛИЦА 1: ПОЛЬЗОВАТЕЛИ
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        telegram_id TEXT PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        phone TEXT,
        city TEXT DEFAULT 'Сыктывкар',
        rating INTEGER DEFAULT 5,
        total_reviews INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// ============================================
// ТАБЛИЦА 2: КАТЕГОРИИ
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT,
        slug TEXT UNIQUE
    )
`);

// ============================================
// ТАБЛИЦА 3: ОБЪЯВЛЕНИЯ
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        price INTEGER,
        city TEXT DEFAULT 'Сыктывкар',
        address TEXT,
        status TEXT DEFAULT 'active',
        views INTEGER DEFAULT 0,
        is_vip INTEGER DEFAULT 0,
        is_business INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(telegram_id),
        FOREIGN KEY(category_id) REFERENCES categories(id)
    )
`);

// ============================================
// ТАБЛИЦА 4: ФОТО ОБЪЯВЛЕНИЙ
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
    )
`);

// ============================================
// ТАБЛИЦА 5: ИЗБРАННОЕ
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        listing_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, listing_id),
        FOREIGN KEY(user_id) REFERENCES users(telegram_id),
        FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
    )
`);

// ============================================
// ТАБЛИЦА 6: ЧАТЫ (НОВОЕ!)
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        listing_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(buyer_id, seller_id, listing_id),
        FOREIGN KEY(buyer_id) REFERENCES users(telegram_id),
        FOREIGN KEY(seller_id) REFERENCES users(telegram_id),
        FOREIGN KEY(listing_id) REFERENCES listings(id)
    )
`);

// ============================================
// ТАБЛИЦА 7: СООБЩЕНИЯ (НОВОЕ!)
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        sender_id TEXT NOT NULL,
        text TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY(sender_id) REFERENCES users(telegram_id)
    )
`);

// ============================================
// ЗАПОЛНЯЕМ КАТЕГОРИИ
// ============================================
const categoriesCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;

if (categoriesCount === 0) {
    const insertCategory = db.prepare('INSERT INTO categories (name, icon, slug) VALUES (?, ?, ?)');
    
      const categories = [
        ['Транспорт', '🚗', 'transport'],
        ['Недвижимость', '🏠', 'realty'],
        ['Работа', '💼', 'jobs'],
        ['Услуги', '', 'services'],
        ['Электроника', '📱', 'electronics'],
        ['Для дома и дачи', '🛋️', 'home'],
        ['Личные вещи', '👕', 'personal'],
        ['Хобби и отдых', '🎨', 'hobby'],
        ['Животные', '🐾', 'animals'],
        ['Бизнес', '🏢', 'business'],
        ['Отдам даром', '🎁', 'free']  // НОВАЯ КАТЕГОРИЯ!
    ];

    const insertMany = db.transaction((cats) => {
        for (const cat of cats) {
            insertCategory.run(...cat);
        }
    });

    insertMany(categories);
    console.log('✅ Категории добавлены в базу');
}
// ============================================
// ТАБЛИЦА 8: ОТЗЫВЫ (НОВОЕ!)
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id TEXT NOT NULL,
        to_user_id TEXT NOT NULL,
        listing_id INTEGER NOT NULL,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(from_user_id, to_user_id, listing_id),
        FOREIGN KEY(from_user_id) REFERENCES users(telegram_id),
        FOREIGN KEY(to_user_id) REFERENCES users(telegram_id),
        FOREIGN KEY(listing_id) REFERENCES listings(id)
    )
`);
// ============================================
// ============================================

// ТАБЛИЦА 9: БИЗНЕС-ПРОФИЛИ (ИСПРАВЛЕНО!)
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS business_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE NOT NULL,
        business_name TEXT NOT NULL,
        logo_filename TEXT,
        description TEXT,
        phone TEXT,
        address TEXT,
        website TEXT,
        category TEXT,
        is_premium INTEGER DEFAULT 0,
        premium_until DATETIME,
        gallery TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(telegram_id)
    )
`);

// ============================================
// ТАБЛИЦА 10: УСЛУГИ БИЗНЕСА (НОВОЕ!)
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS business_services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price INTEGER,
        duration_minutes INTEGER,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(business_id) REFERENCES business_profiles(user_id) ON DELETE CASCADE
    )
`);

// ============================================
// ТАБЛИЦА 11: ПОДПИСКИ (НОВОЕ!)
// ============================================
db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,  -- 'basic', 'premium', 'vip'
        start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_date DATETIME,
        amount INTEGER,
        status TEXT DEFAULT 'active',  -- 'active', 'cancelled', 'expired'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(telegram_id)
    )
`);
// Добавляем колонку is_business, если её нет
try {
    db.prepare('ALTER TABLE listings ADD COLUMN is_business INTEGER DEFAULT 0').run();
    console.log('✅ Добавлена колонка is_business');
} catch (error) {
    // Колонка уже существует — это нормально
    console.log('ℹ️ Колонка is_business уже существует');
}

module.exports = db;