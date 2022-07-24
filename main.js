const config = require("./config.json");

// TELEGRAM
const TeleBot = require('telebot');
const bot = new TeleBot({
    token: '5500307758:AAGXi8AYMEs6B11xoFPn-B91eqJVebTrEr8'
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

// Создание пользователя
const createUser = async (ref) => {
    await ref.set({
        lvl: 0,
        first_level_reaction: false,
        second_level_reactions: [],
        second_level_messages: 0,
        third_level_tg: false,
        third_level_tw: false,
        third_level_invites: 0
    });
}

const syncLevel = user_info => {
    if(user_info.lvl === 0 && user_info.first_level_reaction) {
        user_info.lvl = 1;
    }

    if(user_info.lvl === 1 && 
        user_info.second_level_messages === config.second_level_messages_count && 
        user_info.second_level_reactions.length === config.second_level_reactions_count) {
        user_info.lvl = 2;
    }
    
    if(user_info.lvl === 2 && user_info.third_level_tg && user_info.third_level_tw && user_info.third_level_invites === config.third_invites_count) {
        user_info.lvl = 3;
    }

    return user_info;
}

// Первый уровень
const giveFirstLevel = async (author_id) => {
    const users_ref = db.collection('users').doc(author_id);

    let doc = await users_ref.get();
    if(!doc.exists) { 
        await createUser(users_ref);
        doc = await users_ref.get();
    }

    const data = doc.data();
    if(data.first_level_reaction) return;

    data.first_level_reaction = true;
    const new_data = syncLevel(data);

    await users_ref.update(new_data);
}

// Второй уровень - реакции
const addSecondLevelReaction = async (author_id, message_id) => {
    const users_ref = db.collection('users').doc(author_id);

    let doc = await users_ref.get();
    if(!doc.exists) { 
        await createUser(users_ref);
        doc = await users_ref.get();
    }

    const data = doc.data();
    const has_reactions = () => data.second_level_reactions.length === config.second_level_reactions_count;
    const has_messages = () => data.second_level_messages === config.second_level_messages_count;

    if(data.second_level_reactions.includes(message_id)) return;
    if(has_reactions() && has_messages()) return;

    data.second_level_reactions.push(message_id);
    const new_data = syncLevel(data);

    await users_ref.update(new_data);
}

// Второй уровень - сообщения
const addSecondLevelMessage = async (author_id, message_length) => {
    const users_ref = db.collection('users').doc(author_id);

    let doc = await users_ref.get();
    if(!doc.exists) { 
        await createUser(users_ref);
        doc = await users_ref.get();
    }

    const data = doc.data();
    const has_reactions = () => data.second_level_reactions.length === config.second_level_reactions_count;
    const has_messages = () => data.second_level_messages === config.second_level_messages_count;

    if(has_messages()) return;
    if(message_length < config.second_level_message_min_length) return;
    if(has_reactions() && has_messages()) return;

    data.second_level_messages++;
    const new_data = syncLevel(data);

    await users_ref.update(new_data);
}

// Третий уровень - телеграмм
const setThirdLevelTelegram = async (author_id, telegram_id) => {
    const users_ref = db.collection('users').doc(author_id);

    let doc = await users_ref.get();
    if(!doc.exists) { 
        await createUser(users_ref);
        doc = await users_ref.get();
    }

    const data = doc.data();

    if(data.third_level_tg) return;
    if(data.third_level_tg && data.third_level_tw && data.third_level_invites === config.third_invites_count) return;

    try {
        const user_status = await bot.getChatMember(config.telegram_channel, telegram_id);
        if(user_status.status === 'left') return;

        data.third_level_tg = true;
        const new_data = syncLevel(data);

        await users_ref.update(new_data);
    } catch (_) {}
}

const addThirdLevelInvite = async (author_id) => {
    const users_ref = db.collection('users').doc(author_id);

    let doc = await users_ref.get();
    if(!doc.exists) { 
        await createUser(users_ref);
        doc = await users_ref.get();
    }

    const data = doc.data();
    if(data.third_level_invites === config.third_invites_count) return;

    data.third_level_invites++;
    const new_data = syncLevel(data);

    await users_ref.update(new_data);
}

const getLevelInfo = async (author_id) => {
    const doc = await db.collection('users').doc(author_id).get();
    const lvl_data = doc.exists ? await doc.data() : {
        lvl: 0
    };
    
    return lvl_data;
}

let guildInvites = new Map();

client.on('inviteCreate', async invite => {
    const invites = await invite.guild.fetchInvites();

    guildInvites.set(invite.guild.id, invites);
})

client.on('ready', async () => {
    console.log('I am ready!');

    // Обновление списка сообщений
    // guildInvites = await client.guilds.cache.array()[1].fetchInvites();
    // client.guilds.cache.array()[1].channels.cache.filter(channel => channel.type === "text").each(channel => channel.messages.fetch());

    client.guilds.cache.each(async (guild) => {
        guildInvites.set(guild.id, await guild.fetchInvites());
        guild.channels.cache.filter(channel => channel.type === "text").each(channel => channel.messages.fetch());
        return;
    })
});

client.on('guildMemberAdd', async member => {
    const newInvites = await member.guild.fetchInvites();

    try {
        const usedInvite = newInvites.find(inv => guildInvites.get(inv.code).uses < inv.uses);

        const author_id = usedInvite.inviter.id;
        addThirdLevelInvite(author_id);
    } catch (err) {
        console.log("OnGuildMemberAdd Error:", err)
    }
    guildInvites.set(member.guild.id, newInvites);
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

        message.channel.send(`Ваш текущий уровень: ${lvl_info.lvl}!`);
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
        setThirdLevelTelegram(author_id, telegram_id);
        return;
    }

    if(args[0] === '!твиттер') {
        if(args.length !== 2) {
            message.channel.send("Неправильно набрана команда. Правильный формат: !твиттер <ВАШ-ID-ТВИТТЕР>");
            return;
        }

        const twitter_id = args[1];
        return;
    }

    addSecondLevelMessage(author_id, message.content.length);
});

client.on("messageReactionAdd", (reaction, user) => {
    if(user.bot) return;
    const author_id = user.id;

    // 1 Уровень
    if(reaction.message.id === config.first_level_message_id) {
        giveFirstLevel(author_id);
        return;
    }

    // 2 Уровень
    addSecondLevelReaction(author_id, reaction.message.id);
})

client.login('OTk3NDEzMzAzMjM0MDgwODIx.GRKa0K.-XkB7NIyH76mzxbO5O8EwLqsGZtl2MGZgGy49s');