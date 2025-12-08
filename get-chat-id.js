const axios = require('axios');

// Простий скрипт для отримання chat_id
async function getChatId() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    console.error('❌ Встановіть змінну середовища TELEGRAM_BOT_TOKEN');
    console.log('Приклад: TELEGRAM_BOT_TOKEN=your_token node get-chat-id.js');
    process.exit(1);
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
    const response = await axios.get(url);
    
    if (response.data.ok && response.data.result.length > 0) {
      console.log('\n📋 Знайдені чати:\n');
      
      const chats = new Map();
      response.data.result.forEach(update => {
        if (update.message && update.message.chat) {
          const chat = update.message.chat;
          const key = `${chat.id}_${chat.type}`;
          
          if (!chats.has(key)) {
            chats.set(key, {
              id: chat.id,
              type: chat.type,
              title: chat.title || chat.first_name || chat.username || 'Без назви',
              username: chat.username ? `@${chat.username}` : null
            });
          }
        }
      });

      chats.forEach((chat, key) => {
        console.log(`💬 ${chat.title}${chat.username ? ` (${chat.username})` : ''}`);
        console.log(`   Тип: ${chat.type}`);
        console.log(`   Chat ID: ${chat.id}`);
        console.log('');
      });

      console.log('✅ Скопіюйте потрібний Chat ID і додайте його як TELEGRAM_ADMIN_CHAT_ID\n');
      
    } else {
      console.log('⚠️  Повідомлень не знайдено.');
      console.log('📝 Напишіть щось вашому боту і запустіть скрипт знову.\n');
    }
  } catch (error) {
    console.error('❌ Помилка:', error.message);
    if (error.response) {
      console.error('Відповідь API:', error.response.data);
    }
  }
}

getChatId();

