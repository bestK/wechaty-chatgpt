import { ChatGPTAPI } from 'chatgpt';
import { FileBox } from 'file-box';
import qrcodeTerminal from 'qrcode-terminal';
import { WechatyBuilder } from 'wechaty';

const api = new ChatGPTAPI({
  apiKey: process.env.OPENAI_API_KEY,
  apiBaseUrl: process.env.apiBaseUrl,
});


const conversationPool = new Map();

const wechaty = WechatyBuilder.build({
  name: 'wechaty-chatgpt',
  puppet: 'wechaty-puppet-wechat4u',
  puppetOptions: {
    uos: true,
  },
});
wechaty
  .on('scan', async (qrcode, status) => {
    qrcodeTerminal.generate(qrcode, { small: true }); // 在console端显示二维码
    const qrcodeImageUrl = ['https://api.qrserver.com/v1/create-qr-code/?data=', encodeURIComponent(qrcode)].join('');
    console.log(qrcodeImageUrl);
  })
  .on('login', user => console.log(`User ${user} logged in`))
  .on('logout', user => console.log(`User ${user} has logged out`))
  .on('room-invite', async roomInvitation => {
    try {
      // 自动通过群聊邀请
      console.log(`received room-invite event.`);
      await roomInvitation.accept();
    } catch (e) {
      console.error(e);
    }
  })
  .on('room-join', async (room, inviteeList, inviter) => {
    console.log('received room-join event ');
  })
  .on('friendship', async friendship => {
    try {
      console.log(`received friend event from ${friendship.contact().name()}, messageType: ${friendship.type()}`);
    } catch (e) {
      console.error(e);
    }
  })
  .on('message', async message => {
    const contact = message.talker();
    const receiver = message.listener();
    let content = message.text();
    const room = message.room();
    const isText = message.type() === wechaty.Message.Type.Text;

    if (!isText) {
      return;
    }
    if (room) {
      const topic = await room.topic();
      if (await message.mentionSelf()) {
        let receiverName = '';
        if (receiver) {
          // 支持修改机器人群聊昵称  https://github.com/sunshanpeng/wechaty-chatgpt/issues/3
          const alias = await room.alias(receiver);
          receiverName = alias || receiver.name();
        }
        const groupContent = content.replace(`@${receiverName}`, '');
        console.log(`groupContent:${groupContent}`);
        if (groupContent) {
          content = groupContent.trim();
          if (!content.startsWith('/c')) {
            // 支持在群里@直接调用
            await chatgptReply(room, contact, content);
          }
        } else {
          //todo 光@，没内容
          console.log(`@ event emit. room name: ${topic} contact: ${contact} content: ${content}`);
        }
      }
      console.log(`room name: ${topic} contact: ${contact} content: ${content}`);
      reply(room, contact, content);
    } else {
      console.log(`contact: ${contact} name:${contact.payload.alias} content: ${content}`);

      reply(null, contact, content);
    }
  });
wechaty
  .start()
  .then(() => console.log('Start to log in wechat...'))
  .catch(e => console.error(e));

async function reply(room, contact, content) {
  content = content.trim();

  const target = room || contact;
  const admin = process.env.ADMIN
  const is_admin = target.payload.alias === admin

  if (is_admin && content === 'ding') {
    await send(target, 'dong');
  }

  const prefix = content.split(' ')[0]

  const keywords = ['/c', '/chatgpt', '/表情包']

  const hit_prefix = keywords.includes(prefix)

  if (hit_prefix || is_admin) {
    const request = hit_prefix ? content.replace(prefix, '') : content;

    switch (prefix) {
      case '/表情包':
        await send(target, await plugin_sogou_pic(request), wechaty.puppet.wechat4u)
        break;

      default:
        await chatgptReply(target, contact, request);
        break;
    }


  }

}

async function chatgptReply(room, contact, request) {
  console.log(`contact: ${contact} request: ${request}`);
  let response = '🤒🤒🤒出了一点小问题，请稍后重试下...';
  try {
    let opts = {};
    // conversation
    let conversation = conversationPool.get(contact.id);
    if (conversation) {
      opts = conversation;
    }
    opts.timeoutMs = 2 * 60 * 1000;
    let res = await api.sendMessage(request, opts);
    response = res.text;
    console.log(`contact: ${contact} response: ${response}`);
    conversation = {
      conversationId: res.conversationId,
      parentMessageId: res.id,
    };
    conversationPool.set(contact.id, conversation);
  } catch (e) {
    if (e.message === 'ChatGPTAPI error 429') {
      response = '🤯🤯🤯请稍等一下哦，我还在思考你的上一个问题';
    }
    console.error(e);
  }
  // response = `${request} \n ------------------------ \n` + response;
  const target = room || contact;
  await send(target, response);
}

async function send(contact, message, bot = null) {
  try {
    await contact.say(message);
  } catch (e) {
    console.error(e);
  }
}



async function plugin_sogou_pic(keyword) {
  try {
    const url = `https://pic.sogou.com/napi/wap/emoji/searchlist?keyword=${keyword?.trim()}&spver=&rcer=&tag=0&routeName=emosearch`

    const api = await fetch(url)

    const resp = await api.json()

    const emotions = resp['data']['emotions']

    let random = Math.floor((Math.random() * emotions.length))

    const pic_url = emotions[random]['thumbSrc']


    // 必须为 gif 结尾 否则将作为图片发送 https://github.com/nodeWechat/wechat4u/blob/f66fb69a352b4775210edd87d1101d7a165de797/src/wechat.js#L63
    return FileBox.fromUrl(pic_url, { name: `${new Date().getTime()}.gif` })
  } catch (error) {
    console.error(`get sogou pic has error:${error.message}`)
    return null
  }
}