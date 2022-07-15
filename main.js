const config = require("./config.json");

// TELEGRAM
const TeleBot = require('telebot');
const bot = new TeleBot({
    token: config.telegram_token
});

// FIRESTORE
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require("./firebase_config.json");

initializeApp({
    credential: cert(serviceAccount)
});
  
const db = getFirestore();

// DISCORD
const Discord = require("discord.js");

const client = new Discord.Client();

const BASE_LEVEL = config.base_level;
const PLUS_LEVEL = config.plus_level;
const ACTIVITY_LEVEL = config.activity_level;
const SOCIAL_LEVEL = config.social_level;

const getLevelInfo = async (author_id) => {
    const doc = await db.collection('users').doc(author_id).get();
    const lvl_data = await doc.data();
    
    return lvl_data;
}

const addActivityCount = async (author_id, value) => {
    const users_ref = db.collection('users').doc(author_id);

    let doc = await users_ref.get();
    const lvl_data = doc.exists ? await doc.data() : {
        lvl: 1,
        activity: 0,
        next_lvl: BASE_LEVEL,
        is_telegram_active: false,
        is_twitter_active: false
    };

    lvl_data.activity += value;
    while(lvl_data.next_lvl <= lvl_data.activity) {
        lvl_data.next_lvl += PLUS_LEVEL;
        lvl_data.lvl++;
    }

    await users_ref.set(lvl_data);
}

const setTelegramActive = async (author_id) => {
    const users_ref = db.collection('users').doc(author_id);
    await users_ref.update({
        is_telegram_active: true
    });
}

const hasSocialActive = async (author_id, social_field) => {
    const users_ref = db.collection('users').doc(author_id);
    let doc = await users_ref.get();
    if(!doc.exists) {
        await users_ref.set({
            lvl: 1,
            activity: 0,
            next_lvl: BASE_LEVEL,
            is_telegram_active: false,
            is_twitter_active: false
        });

        doc = await users_ref.get();
    }

    return (await doc.data())[social_field];
}

client.on('ready', () => {
    console.log('I am ready!');
    
    // Обновление списка сообщений
    client.guilds.cache.each(guild => {
        guild.channels.cache.filter(channel => channel.type === "text").each(channel => channel.messages.fetch());
    })
});

client.on("message", async (message) => {
    if(message.author.bot) return;
    const author_id = message.author.id;

    if(message.content === '!команды') {
        message.channel.send('Показать свой уровень: !уровень\nПривязать телеграмм: !тг <ВАШ-ID-ТЕЛЕГРАММ>\nПривязать твиттер: !твиттер <ВАШ-ID-ТВИТТЕР>');
        return;
    }

    if(message.content === '!уровень') {
        const lvl_info = await getLevelInfo(author_id);

        message.channel.send(`Ваш текущий уровень: ${lvl_info.lvl}. До следующего уровня: ${lvl_info.next_lvl - lvl_info.activity}`);
        return;
    }

    const args = message.content.split(" ");
    if(args.length === 0) return;
    
    if(args[0] === '!тг') {
        if(args.length !== 2) {
            message.channel.send("Неправильно набрана команда. Правильный формат: !тг <ВАШ-ID-ТЕЛЕГРАММ>");
            return;
        }

        const telegram_id = args[1];
        if(await hasSocialActive(author_id, 'is_telegram_active')) {
            message.channel.send("Вы уже привязали телеграмм аккаунт.");
            return;
        }

        try {
            const user_status = await bot.getChatMember(config.telegram_channel, telegram_id);
            if(user_status.status === 'left') {
                message.channel.send("Данного пользователя нет в нашем телеграмм канале.");
                return;
            }

            message.channel.send("Пользователь является нашим подписчиком! Вам начислены дополнительные баллы!");
            addActivityCount(author_id, SOCIAL_LEVEL);
            setTelegramActive(author_id);
        } catch (e) {
            console.log(e);
            message.channel.send("Данного пользователя нет в нашем телеграмм канале.");
        } finally {
            return;
        }
    }

    if(args[0] === '!твиттер') {
        if(args.length !== 2) {
            message.channel.send("Неправильно набрана команда. Правильный формат: !твиттер <ВАШ-ID-ТВИТТЕР>");
            return;
        }

        const twitter_id = args[1];
        if(await hasSocialActive(author_id, 'is_twitter_active')) {
            message.channel.send("Вы уже привязали твиттер аккаунт.");
            return;
        }


    }
        
    addActivityCount(author_id, ACTIVITY_LEVEL);
});

client.on("messageReactionAdd", (_, user) => {
    if(user.bot) return;
    const author_id = user.id;

    addActivityCount(author_id, ACTIVITY_LEVEL);
})

client.login(config.discord_token);