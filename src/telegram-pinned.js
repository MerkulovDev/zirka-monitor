const axios = require('axios');

// Функція для визначення, чи можна відправляти повідомлення в поточний час
function canSendMessage() {
  const now = new Date();
  const hour = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hour * 60 + minutes; // Час в хвилинах від початку дня
  const dayOfWeek = now.getDay(); // 0 = неділя, 6 = субота
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  // 00:00-06:00 - відправляємо лише беззвучно
  if (currentTime >= 0 && currentTime < 360) {
    return { canSend: true, silent: true, reason: 'Нічний час (00:00-06:00)' };
  }
  
  // 06:00-08:00 - беззвучні повідомлення
  if (currentTime >= 360 && currentTime < 480) {
    return { canSend: true, silent: true, reason: 'Ранковий час (06:00-08:00)' };
  }
  
  // 22:00-23:59 - беззвучні повідомлення
  if (currentTime >= 1320 && currentTime < 1440) {
    return { canSend: true, silent: true, reason: 'Вечірній час (22:00-23:59)' };
  }
  
  // Вихідні 06:00-10:00 - беззвучні повідомлення
  if (isWeekend && currentTime >= 360 && currentTime < 600) {
    return { canSend: true, silent: true, reason: 'Вихідний ранковий час (06:00-10:00)' };
  }
  
  // В інший час - звичайні повідомлення
  return { canSend: true, silent: false, reason: 'Робочий час' };
}

// Функція для відправки повідомлення в Telegram
async function sendTelegramMessage(message, silent = false, pinMessage = false) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('⚠️  Telegram не налаштовано (відсутні TELEGRAM_BOT_TOKEN або TELEGRAM_CHAT_ID)');
    return false;
  }

  // Перевіряємо, чи можна відправляти в поточний час
  const sendStatus = canSendMessage();
  
  if (!sendStatus.canSend) {
    console.log(`⏸️  Повідомлення не відправлено: ${sendStatus.reason}`);
    return false;
  }

  if (sendStatus.silent) {
    console.log(`🔇 Повідомлення буде відправлено беззвучно: ${sendStatus.reason}`);
  }

  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_notification: sendStatus.silent || silent,
    });

    if (response.data.ok) {
      const silentText = (sendStatus.silent || silent) ? ' (беззвучно)' : '';
      console.log(`✅ Повідомлення відправлено в Telegram${silentText}`);
      
      // Закріплюємо повідомлення якщо потрібно
      if (pinMessage) {
        const messageId = response.data.result.message_id;
        // Спочатку відкріплюємо всі попередні повідомлення
        await unpinAllChatMessages();
        // Потім закріплюємо нове
        await pinTelegramMessage(messageId, true); // true = беззвучне закріплення
      }
      
      return true;
    } else {
      console.error('❌ Помилка відправки в Telegram:', response.data);
      return false;
    }
  } catch (error) {
    let errorDetails = error.message;
    
    // Якщо є відповідь від Telegram API, виводимо детальну інформацію
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      errorDetails = `HTTP ${status}: ${data?.description || data?.error_code || 'Невідома помилка'}`;
      
      // Додаткова інформація про тип помилки
      if (data?.error_code === 400) {
        errorDetails += ' (Невірний запит - перевірте формат повідомлення)';
      } else if (data?.error_code === 401) {
        errorDetails += ' (Невірний токен бота)';
      } else if (data?.error_code === 403) {
        errorDetails += ' (Бот не має доступу до чату/каналу)';
      } else if (data?.error_code === 404) {
        errorDetails += ' (Чат/канал не знайдено)';
      } else if (data?.error_code === 429) {
        errorDetails += ' (Перевищено ліміт запитів - rate limit)';
      } else if (status >= 500) {
        errorDetails += ' (Помилка сервера Telegram)';
      }
      
      console.error('❌ Помилка при відправці в Telegram:', errorDetails);
      if (data) {
        console.error('   Деталі від Telegram API:', JSON.stringify(data, null, 2));
      }
    } else if (error.request) {
      errorDetails = 'Немає відповіді від сервера Telegram (перевірте інтернет-з\'єднання)';
      console.error('❌ Помилка при відправці в Telegram:', errorDetails);
    } else {
      console.error('❌ Помилка при відправці в Telegram:', errorDetails);
      console.error('   Stack:', error.stack);
    }
    
    return false;
  }
}

// Функція для відкріплення всіх повідомлень
async function unpinAllChatMessages() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('⚠️  Telegram не налаштовано');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/unpinAllChatMessages`;
    const response = await axios.post(url, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
    });

    if (response.data.ok) {
      console.log(`📍 Всі попередні повідомлення відкріплено`);
      return true;
    } else {
      console.error('❌ Помилка відкріплення:', response.data);
      return false;
    }
  } catch (error) {
    let errorDetails = error.message;
    if (error.response) {
      const data = error.response.data;
      errorDetails = `HTTP ${error.response.status}: ${data?.description || data?.error_code || 'Невідома помилка'}`;
      console.error('❌ Помилка при відкріпленні:', errorDetails);
      if (data) {
        console.error('   Деталі:', JSON.stringify(data, null, 2));
      }
    } else {
      console.error('❌ Помилка при відкріпленні:', errorDetails);
    }
    return false;
  }
}

// Функція для закріплення повідомлення в Telegram
async function pinTelegramMessage(messageId, silent = true) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('⚠️  Telegram не налаштовано');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/pinChatMessage`;
    const response = await axios.post(url, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      message_id: messageId,
      disable_notification: silent,
    });

    if (response.data.ok) {
      console.log(`📌 Нове повідомлення закріплено`);
      return true;
    } else {
      console.error('❌ Помилка закріплення:', response.data);
      return false;
    }
  } catch (error) {
    let errorDetails = error.message;
    if (error.response) {
      const data = error.response.data;
      errorDetails = `HTTP ${error.response.status}: ${data?.description || data?.error_code || 'Невідома помилка'}`;
      console.error('❌ Помилка при закріпленні:', errorDetails);
      if (data) {
        console.error('   Деталі:', JSON.stringify(data, null, 2));
      }
    } else {
      console.error('❌ Помилка при закріпленні:', errorDetails);
    }
    return false;
  }
}

// Функція для відправки повідомлення тільки адміну (якщо налаштовано TELEGRAM_ADMIN_CHAT_ID)
async function sendTelegramMessageToAdmin(message) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('⚠️  Telegram не налаштовано (відсутній TELEGRAM_BOT_TOKEN)');
    return false;
  }

  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId) {
    console.log('⚠️  TELEGRAM_ADMIN_CHAT_ID не налаштовано, помилка не відправлена');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: adminChatId,
      text: message,
      parse_mode: 'HTML',
      disable_notification: false, // Помилки адміну завжди з повідомленням
    });

    if (response.data.ok) {
      console.log(`✅ Повідомлення адміну відправлено`);
      return true;
    } else {
      console.error('❌ Помилка відправки адміну:', response.data);
      return false;
    }
  } catch (error) {
    let errorDetails = error.message;
    
    // Якщо є відповідь від Telegram API, виводимо детальну інформацію
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      errorDetails = `HTTP ${status}: ${data?.description || data?.error_code || 'Невідома помилка'}`;
      
      // Додаткова інформація про тип помилки
      if (data?.error_code === 400) {
        errorDetails += ' (Невірний запит - перевірте формат повідомлення)';
      } else if (data?.error_code === 401) {
        errorDetails += ' (Невірний токен бота)';
      } else if (data?.error_code === 403) {
        errorDetails += ' (Бот не має доступу до чату)';
      } else if (data?.error_code === 404) {
        errorDetails += ' (Чат не знайдено)';
      } else if (data?.error_code === 429) {
        errorDetails += ' (Перевищено ліміт запитів - rate limit)';
      } else if (status >= 500) {
        errorDetails += ' (Помилка сервера Telegram)';
      }
      
      console.error('❌ Помилка при відправці адміну:', errorDetails);
      if (data) {
        console.error('   Деталі від Telegram API:', JSON.stringify(data, null, 2));
      }
    } else if (error.request) {
      errorDetails = 'Немає відповіді від сервера Telegram (перевірте інтернет-з\'єднання)';
      console.error('❌ Помилка при відправці адміну:', errorDetails);
    } else {
      console.error('❌ Помилка при відправці адміну:', errorDetails);
      console.error('   Stack:', error.stack);
    }
    
    return false;
  }
}

module.exports = {
  canSendMessage,
  sendTelegramMessage,
  sendTelegramMessageToAdmin,
  pinTelegramMessage,
  unpinAllChatMessages,
};

