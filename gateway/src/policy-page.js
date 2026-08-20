/**
 * What this deployment promises, what it does with what you give it, and what
 * you may not do with the machine it hands you.
 *
 * Three documents, because they answer three different questions and a person
 * looking for one of them should not have to read the other two: the terms are
 * the deal, the data notice is what happens to what you type, and the safe-use
 * policy is what the sandbox may be pointed at. They are linked together, from
 * the sign-in page, and from the landing page's footer.
 *
 * Two things make this deployment's version of these documents shorter than a
 * commercial one, and both are stated rather than implied:
 *
 * - It runs no model. Everything a session says is forwarded to whichever
 *   provider the deployment's key belongs to, and that provider's policies are
 *   what govern the inference — so the safety rules that matter most here are
 *   upstream's, and this policy says so instead of restating them badly.
 * - It therefore has no use for tenant data. There is no training, no
 *   profiling, no analytics and no third-party script anywhere in it — the
 *   pages do not even fetch a font from another host — so the data notice can
 *   say plainly that nothing is used for anything, and then spend its length on
 *   the honest part: what nonetheless LEAVES this deployment, which is the
 *   model provider and the mail sender.
 *
 * The texts are the deployment's own statements about itself and have to stay
 * true of it: every claim below is one the code makes good on, and changing the
 * code without changing these is how a privacy notice becomes a lie. Where a
 * claim depends on the runtime — the model credential is withheld from the
 * sandbox under CubeSandbox and cannot be under plain Docker — it is written to
 * be true of both.
 *
 * @module policy-page
 */

import {
  FONT_PRELOAD,
  GROUND_CSS,
  GROUND_HTML,
  GROUND_SCRIPT,
  BRAND_CSS,
  PALETTE_CSS,
  WORDMARK,
  THEME_TOGGLE,
  escapeHtml,
  langToggle,
} from './page-chrome.js'

import { asset } from './page-assets.js'
/**
 * Which version of these documents a tenant is agreeing to.
 *
 * A date rather than a number, because that is what someone comparing their
 * recorded consent against this page needs to know. It is stored with the
 * agreement on every sign-in, so an account's row says which text it last
 * accepted — bump it whenever any of the three documents changes in substance.
 */
export const POLICY_VERSION = '2026-08-20'

/**
 * The three documents, in the order they are linked in.
 *
 * `p` is a paragraph, `ul` a list. Nothing here interpolates anything but the
 * contact address, which is escaped where it is rendered.
 */
const DOCUMENTS = {
  terms: {
    title: '服务条款',
    lede: '你使用本部署，就表示接受下面这些条款。它们写得直白，因为这是一个自建部署，没有销售也没有客服。',
    sections: [
      {
        h: '一、本服务是什么',
        blocks: [
          { p: '本站是开源项目 HamsterHQ 的一个自建部署，把 DSH（DeepSeek Harness）跑在云端，由本部署的运营者提供。它是独立开发的非官方项目，与 DeepSeek、腾讯云或 DSH、CubeSandbox 的维护者没有从属、赞助或背书关系。' },
          { p: '本服务免费提供，不含任何付费承诺，也不构成任何形式的服务等级协议。' },
        ],
      },
      {
        h: '二、账号',
        blocks: [
          { p: '账号以邮箱验证码注册和登录，没有密码。这意味着能收取该邮箱邮件的人就能进入你的账号，请自行保管邮箱的安全。' },
          { p: '一个账号对应一个独立的沙箱和一份工作区。不要把账号转让或共享给他人——沙箱里可以执行代码、可以联网，你要为它做的事负责。' },
        ],
      },
      {
        h: '三、可用性与数据留存',
        blocks: [
          { p: '本服务按「现状」和「现有」提供，不保证连续、及时、安全或无差错，也不保证任何数据不会丢失。' },
          {
            ul: [
              '沙箱在闲置一段时间后会被回收，网关重启时会被重建；',
              '工作区文件不做备份，运营者也不承诺能够找回任何已删除或已丢失的内容；',
              '本服务可能随时变更、暂停或永久停止。',
            ],
          },
          { p: '请不要把任何重要数据的唯一副本放在这里。' },
        ],
      },
      {
        h: '四、你的内容与你的责任',
        blocks: [
          { p: '你在本服务中输入、生成、上传或存储的内容归你所有，运营者不主张任何权利，也不会将其用于本服务运行之外的任何用途。' },
          { p: '你保证这些内容合法，不侵犯他人权利，并且你的使用方式符合《安全使用政策》以及上游模型服务提供商的使用政策。' },
        ],
      },
      {
        h: '五、模型输出',
        blocks: [
          { p: '推理由上游模型服务提供商完成，本部署不提供模型服务。模型的输出可能不准确、不完整或不适用于你的场景，它不构成法律、医疗、金融或任何其他专业意见。是否采信、如何使用，由你自行判断并承担后果。' },
        ],
      },
      {
        h: '六、责任限制',
        blocks: [
          { p: '在适用法律允许的最大范围内，运营者不对因使用或无法使用本服务而产生的任何直接、间接、偶然或后果性损失承担责任，包括但不限于数据丢失、业务中断、利润损失或第三方索赔。' },
          { p: '如果所在司法辖区不允许上述排除，则运营者的责任以法律允许的最低限度为限。' },
        ],
      },
      {
        h: '七、暂停与终止',
        blocks: [
          { p: '违反本条款或《安全使用政策》的账号，运营者可以在不事先通知的情况下停用或删除。' },
          { p: '你可以随时在「个人资料」页注销账号。注销会删除你的账号、会话、沙箱和工作区数据，且不可恢复。' },
        ],
      },
      {
        h: '八、条款的变更',
        blocks: [
          { p: '条款变更后会在本页公布并更新页首的版本日期。变更后继续使用本服务，视为接受新的条款。' },
        ],
      },
    ],
  },

  privacy: {
    title: '数据处理说明',
    lede: '一句话：本部署不利用你的任何数据。它自己不提供模型服务，没有训练、没有分析、没有画像、没有广告，也没有任何第三方统计。下面写清楚它保存什么、什么会离开这里、保存多久，以及怎么全部删掉。',
    sections: [
      {
        h: '一、保存了什么',
        blocks: [
          {
            ul: [
              '账号：邮箱地址、你自己填的昵称和头像、注册时间、最近登录时间，以及你同意本说明的时间与版本；',
              '登录：一次性验证码（10 分钟内有效，用过即废）和登录会话凭据（默认 30 天，登出即撤销）；',
              '工作区：你在沙箱里创建的文件，存放在本部署自己的存储上；',
              '沙箱环境变量：你在设置里自己填写的键值，按密钥对待——只写入沙箱，不回显给浏览器；',
              '运行日志：网关会记录登录、拒绝原因、沙箱创建与回收等事件，其中包含邮箱地址，用于排障和防止滥用。',
            ],
          },
          { p: '除此之外没有别的了。本部署不使用 Cookie 做任何追踪，只用它保存你的登录会话。' },
        ],
      },
      {
        h: '二、不做什么',
        blocks: [
          {
            ul: [
              '不用你的对话、文件或任何内容训练模型——本部署不提供模型服务，也不具备训练能力；',
              '不做用户画像、行为分析或广告投放；',
              '不接入任何第三方统计、追踪或广告脚本；本部署的页面所需的字体和图片全部由它自己提供，不向其他站点发起请求；',
              '不向第三方出售、出租或交换你的数据。',
            ],
          },
        ],
      },
      {
        h: '三、什么会离开这个部署',
        blocks: [
          { p: '这是最需要你知道的一节。本部署是一个中转，有两类数据必然会交给第三方：' },
          {
            ul: [
              '模型推理：你在会话里输入的内容，以及智能体为完成任务而读取到的文件内容，会发送给本部署所配置的上游模型服务提供商（默认为 DeepSeek）。这些数据如何被处理，适用该提供商自己的隐私政策与使用政策，不在本部署的控制范围内；',
              '登录邮件：验证码通过第三方邮件服务发出，该服务会处理你的邮箱地址；',
              '你自己让智能体去访问的网络资源：沙箱可以联网，你让它抓取或调用什么，数据就会到达那里。',
            ],
          },
          { p: '除以上情形，以及法律要求或为保护本服务与他人权利所必需的情况外，运营者不会向任何第三方提供你的数据。' },
        ],
      },
      {
        h: '四、保存多久',
        blocks: [
          {
            ul: [
              '验证码：10 分钟，或用过即废；',
              '会话凭据：默认 30 天；登出会立即撤销该账号的全部会话；',
              '沙箱：闲置后回收、重启时重建，其中未保存到工作区的内容随之消失；',
              '工作区文件与账号信息：保留到你注销账号，或运营者删除该账号为止；',
              '运行日志：随容器生命周期滚动保留，用于排障。',
            ],
          },
          { p: '本部署不做备份，因此删除是不可恢复的——这既是风险，也是它能保证「删掉就是删掉」的原因。' },
        ],
      },
      {
        h: '五、你的权利',
        blocks: [
          {
            ul: [
              '查看和修改：昵称与头像在「个人资料」页随时可改；',
              '删除：在「个人资料」页注销账号，会一并删除账号、会话、沙箱与工作区数据，不可恢复；',
              '其他关于个人信息的请求：联系运营者。',
            ],
          },
        ],
      },
      {
        h: '六、安全措施',
        blocks: [
          {
            ul: [
              '每个账号运行在自己的沙箱里，租户之间彼此不可见；',
              '会话凭据可以被撤销，停用或删除账号会立即使其失效；',
              '你填写的沙箱环境变量只写不读回；',
              '在支持的运行时下，部署的模型密钥不会进入沙箱，由出口网关在请求离开时补上。',
            ],
          },
          { p: '同时请清楚：这是一个自建部署，不承诺任何合规认证，也不承诺绝对安全。' },
        ],
      },
      {
        h: '七、未成年人',
        blocks: [
          { p: '本服务不面向儿童。如果你未满 18 周岁，请在监护人的知情与同意下使用。' },
        ],
      },
      {
        h: '八、变更',
        blocks: [
          { p: '本说明变更后会在本页公布并更新页首的版本日期。' },
        ],
      },
    ],
  },

  security: {
    title: '安全使用政策',
    lede: '本部署给你的是一台可以执行代码、可以联网的机器，还有一个替你操作它的智能体。下面这些事不能用它做——违反的账号会被停用或删除。',
    sections: [
      {
        h: '一、不得违法或侵权',
        blocks: [
          { p: '不得将本服务用于任何违反所适用法律法规的活动，不得用它生成、存储或传播侵犯他人知识产权、隐私、名誉等权利的内容，不得生成法律禁止的内容。' },
        ],
      },
      {
        h: '二、不得攻击或干扰他人系统',
        blocks: [
          {
            ul: [
              '未经授权的扫描、探测、渗透测试或入侵；',
              '拒绝服务攻击，或任何形式的流量泛洪；',
              '制作或传播恶意程序、勒索软件、僵尸网络控制端；',
              '窃取、破解或倒卖他人凭据。',
            ],
          },
        ],
      },
      {
        h: '三、不得滥用资源',
        blocks: [
          {
            ul: [
              '加密货币挖矿，或其他以消耗算力为目的的运算；',
              '大规模爬取，或对第三方站点造成明显负担的自动化访问；',
              '把沙箱当作代理、跳板、翻墙节点、长期托管或 CDN 使用；',
              '通过多开账号绕过部署的容量上限。',
            ],
          },
          { p: '沙箱是给你完成一件事用的工作台，不是一台可以长期占用的服务器。' },
        ],
      },
      {
        h: '四、不得用于骚扰与垃圾信息',
        blocks: [
          { p: '不得用它群发垃圾邮件或推广信息，不得用于批量骚扰、欺诈、钓鱼或冒充他人。' },
        ],
      },
      {
        h: '五、模型的使用须遵守上游的政策',
        blocks: [
          { p: '本部署不提供模型服务，推理由上游模型服务提供商完成，因此模型层面的安全与内容策略以该提供商的政策为准，并同样约束你在本部署中的使用。' },
          { p: '特别地，不得试图绕过、规避或诱导模型突破其安全机制，不得将本部署作为转售或分发模型能力的通道。' },
        ],
      },
      {
        h: '六、不得攻击本部署本身',
        blocks: [
          { p: '不得试图突破沙箱隔离、访问其他租户的数据、获取部署的密钥，或干扰网关、存储与其他共享设施的正常运行。' },
          { p: '如果你发现了安全问题，请联系运营者，而不是利用它。负责任地报告会得到感谢。' },
        ],
      },
      {
        h: '七、违规的处理',
        blocks: [
          { p: '运营者可以在不事先通知的情况下停用或删除违规账号、回收其沙箱，并在法律要求时配合有权机关。' },
        ],
      },
    ],
  },
}

/**
 * The same three documents in English.
 *
 * A separate structure of the same shape rather than a `{zh, en}` pair on every
 * string, for two reasons: the Chinese above is the text this deployment has
 * actually published and is not worth disturbing to add a second language
 * beside it, and a translation kept whole can be read as a document — which is
 * how anyone would check it — instead of as every other line of one.
 *
 * The Chinese governs. That is stated on the page rather than only here,
 * because two texts of a promise are two promises unless one of them is said to
 * be the one that counts, and it is the Chinese that was agreed to: the consent
 * recorded against an account names `POLICY_VERSION`, and this is a translation
 * of the text that version identifies.
 */
const ENGLISH = {
  "terms": {
    "title": "Terms of Service",
    "lede": "Using this deployment means accepting the terms below. They are written plainly, because this is a self-hosted deployment with no sales team and no support desk.",
    "sections": [
      {
        "h": "1. What this service is",
        "blocks": [
          {
            "p": "This site is a self-hosted deployment of the open-source project HamsterHQ, running DSH (DeepSeek Harness) in the cloud, provided by this deployment's operator. It is an independently developed, unofficial project, with no affiliation with, sponsorship by, or endorsement from DeepSeek, Tencent Cloud, or the maintainers of DSH or CubeSandbox."
          },
          {
            "p": "The service is provided free of charge. It carries no paid commitment and constitutes no service level agreement of any kind."
          }
        ]
      },
      {
        "h": "2. Accounts",
        "blocks": [
          {
            "p": "Accounts are registered and signed in with an emailed code rather than a password. This means anyone who can receive mail at that address can get into your account, so keeping that address secure is your responsibility."
          },
          {
            "p": "One account gets one sandbox and one workspace. Do not transfer or share it: code runs in that sandbox and it can reach the network, and you are answerable for what it does."
          }
        ]
      },
      {
        "h": "3. Availability and data retention",
        "blocks": [
          {
            "p": "The service is provided “as is” and “as available”, with no guarantee that it will be continuous, timely, secure or error-free, and no guarantee that data will not be lost."
          },
          {
            "ul": [
              "sandboxes are reclaimed after a period of inactivity, and rebuilt when the gateway restarts;",
              "workspace files are not backed up, and the operator does not undertake to recover anything deleted or lost;",
              "the service may change, be suspended, or stop permanently at any time."
            ]
          },
          {
            "p": "Do not keep the only copy of anything important here."
          }
        ]
      },
      {
        "h": "4. Your content and your responsibility",
        "blocks": [
          {
            "p": "Content you enter, generate, upload or store in this service is yours. The operator claims no rights over it and will not use it for anything beyond running the service."
          },
          {
            "p": "You warrant that this content is lawful, that it infringes nobody else's rights, and that your use complies with the Safe Use Policy and with the usage policies of the upstream model provider."
          }
        ]
      },
      {
        "h": "5. Model output",
        "blocks": [
          {
            "p": "Inference is performed by the upstream model provider; this deployment runs no model of its own. Model output may be inaccurate, incomplete, or unsuited to your situation, and it is not legal, medical, financial or any other kind of professional advice. Whether to rely on it, and how, is your judgement and your risk."
          }
        ]
      },
      {
        "h": "6. Limitation of liability",
        "blocks": [
          {
            "p": "To the fullest extent permitted by applicable law, the operator is not liable for any direct, indirect, incidental or consequential loss arising from use of, or inability to use, the service — including but not limited to data loss, business interruption, lost profits, or third-party claims."
          },
          {
            "p": "Where your jurisdiction does not permit those exclusions, the operator's liability is limited to the minimum the law allows."
          }
        ]
      },
      {
        "h": "7. Suspension and termination",
        "blocks": [
          {
            "p": "An account that breaches these terms or the Safe Use Policy may be disabled or deleted by the operator without prior notice."
          },
          {
            "p": "You can close your account at any time on the Profile page. Closing it deletes the account, its sessions, its sandbox and its workspace data, and cannot be undone."
          }
        ]
      },
      {
        "h": "8. Changes to these terms",
        "blocks": [
          {
            "p": "Changes are published on this page and the version date at the top is updated. Continuing to use the service after a change means accepting the new terms."
          }
        ]
      }
    ]
  },
  "privacy": {
    "title": "Data Processing Notice",
    "lede": "In one line: this deployment makes no use of your data. It runs no model of its own, and there is no training, no analytics, no profiling, no advertising and no third-party tracking. Below is what it stores, what leaves here, how long it is kept, and how to delete all of it.",
    "sections": [
      {
        "h": "1. What is stored",
        "blocks": [
          {
            "ul": [
              "Account: your email address, the display name and avatar you set, when you registered, when you last signed in, and when and to which version you agreed to this notice;",
              "Sign-in: the one-time code (valid 10 minutes, discarded once used) and your session credential (30 days by default, revoked on sign-out);",
              "Workspace: the files you create in your sandbox, held on this deployment's own storage;",
              "Sandbox environment variables: the keys and values you enter in settings, treated as secrets — written into the sandbox and never echoed back to the browser;",
              "Operational logs: the gateway records sign-ins, refusals and their reasons, and sandbox creation and reclamation. These contain email addresses, and exist for troubleshooting and to prevent abuse."
            ]
          },
          {
            "p": "There is nothing else. No cookie here tracks anything; the only one is the one holding your session."
          }
        ]
      },
      {
        "h": "2. What is not done",
        "blocks": [
          {
            "ul": [
              "your conversations, files and content are not used to train models — this deployment runs no model and has no training capability;",
              "no profiling, behavioural analysis or ad targeting;",
              "no third-party analytics, tracking or advertising script. The fonts and images these pages need are served by the deployment itself, and no request goes to another host;",
              "your data is not sold, rented or exchanged."
            ]
          }
        ]
      },
      {
        "h": "3. What leaves this deployment",
        "blocks": [
          {
            "p": "This is the section worth reading. This deployment is an intermediary, and two kinds of data necessarily reach a third party:"
          },
          {
            "ul": [
              "Model inference: what you type in a session, and the file contents the agent reads in order to carry out a task, are sent to the upstream model provider this deployment is configured with (DeepSeek by default). How that data is then handled is governed by that provider's own privacy and usage policies, and is outside this deployment's control;",
              "Sign-in mail: codes are sent through a third-party mail service, which handles your email address;",
              "Network resources you direct the agent to: the sandbox can reach the network, and whatever you ask it to fetch or call is where your data goes."
            ]
          },
          {
            "p": "Apart from the above, and what the law requires or what is necessary to protect this service and the rights of others, the operator gives your data to nobody."
          }
        ]
      },
      {
        "h": "4. How long it is kept",
        "blocks": [
          {
            "ul": [
              "sign-in codes: 10 minutes, or until used;",
              "session credentials: 30 days by default; signing out revokes every session on that account immediately;",
              "sandboxes: reclaimed when idle and rebuilt on restart, and anything not saved into the workspace goes with them;",
              "workspace files and account details: until you close your account, or the operator deletes it;",
              "operational logs: rolled over with the container lifecycle, for troubleshooting."
            ]
          },
          {
            "p": "This deployment keeps no backups, so a deletion cannot be undone — which is both the risk and the reason it can promise that deleted means deleted."
          }
        ]
      },
      {
        "h": "5. Your rights",
        "blocks": [
          {
            "ul": [
              "See and change: display name and avatar can be changed at any time on the Profile page;",
              "Delete: closing your account on the Profile page deletes the account, its sessions, its sandbox and its workspace data, irreversibly;",
              "Anything else concerning your personal data: contact the operator."
            ]
          }
        ]
      },
      {
        "h": "6. Security measures",
        "blocks": [
          {
            "ul": [
              "each account runs in a sandbox of its own, and tenants cannot see one another;",
              "session credentials can be revoked, and disabling or deleting an account invalidates them at once;",
              "the sandbox environment variables you set are written but never read back;",
              "on runtimes that support it, the deployment's model credential never enters the sandbox: the egress gateway adds it as the request leaves."
            ]
          },
          {
            "p": "Be equally clear about this: it is a self-hosted deployment. It claims no compliance certification and promises no absolute security."
          }
        ]
      },
      {
        "h": "7. Minors",
        "blocks": [
          {
            "p": "This service is not directed at children. If you are under 18, use it with the knowledge and consent of a guardian."
          }
        ]
      },
      {
        "h": "8. Changes",
        "blocks": [
          {
            "p": "Changes to this notice are published on this page and the version date at the top is updated."
          }
        ]
      }
    ]
  },
  "security": {
    "title": "Safe Use Policy",
    "lede": "What this deployment hands you is a machine that can run code and reach the network, and an agent that operates it for you. These are the things it may not be used for; an account that breaches them is disabled or deleted.",
    "sections": [
      {
        "h": "1. Nothing unlawful or infringing",
        "blocks": [
          {
            "p": "The service may not be used for any activity that breaks applicable law, nor to generate, store or distribute content infringing anyone's intellectual property, privacy, reputation or other rights, nor to generate content the law prohibits."
          }
        ]
      },
      {
        "h": "2. No attacking or disrupting other systems",
        "blocks": [
          {
            "ul": [
              "unauthorised scanning, probing, penetration testing or intrusion;",
              "denial-of-service attacks, or traffic flooding of any kind;",
              "building or distributing malware, ransomware, or botnet controllers;",
              "stealing, cracking or trafficking in other people's credentials."
            ]
          }
        ]
      },
      {
        "h": "3. No resource abuse",
        "blocks": [
          {
            "ul": [
              "cryptocurrency mining, or any other computation whose purpose is to consume capacity;",
              "large-scale scraping, or automated access that visibly burdens third-party sites;",
              "using the sandbox as a proxy, a relay, a circumvention node, long-term hosting or a CDN;",
              "opening several accounts to get around the deployment's capacity ceiling."
            ]
          },
          {
            "p": "The sandbox is a workbench for getting something done, not a server to occupy indefinitely."
          }
        ]
      },
      {
        "h": "4. No harassment or spam",
        "blocks": [
          {
            "p": "It may not be used to send bulk spam or promotional mail, nor for mass harassment, fraud, phishing or impersonation."
          }
        ]
      },
      {
        "h": "5. Model use follows the upstream policy",
        "blocks": [
          {
            "p": "This deployment runs no model; inference is performed by the upstream model provider. Safety and content rules at the model layer are therefore that provider's, and they bind your use here just the same."
          },
          {
            "p": "In particular, do not attempt to bypass, evade or coax the model past its safety mechanisms, and do not use this deployment as a channel for reselling or redistributing model capability."
          }
        ]
      },
      {
        "h": "6. No attacking this deployment",
        "blocks": [
          {
            "p": "Do not attempt to break out of the sandbox, reach another tenant's data, obtain the deployment's credentials, or interfere with the gateway, the storage or any other shared facility."
          },
          {
            "p": "If you find a security problem, contact the operator rather than exploiting it. A responsible report is appreciated."
          }
        ]
      },
      {
        "h": "7. How breaches are handled",
        "blocks": [
          {
            "p": "The operator may disable or delete an offending account and reclaim its sandbox without prior notice, and will cooperate with the competent authorities where the law requires."
          }
        ]
      }
    ]
  }
}

/**
 * Every string in one document, under a key derived from where it sits.
 *
 * Position, not content, so the two languages are paired by structure and a
 * translation cannot come to sit under the wrong paragraph. The renderer builds
 * its `data-t` attributes from the same formula, and `sameShape` below refuses
 * a pair that no longer lines up — which is what a translation drifts into
 * first, long before anyone notices a sentence is missing.
 *
 * @param {object} document - one of the documents above.
 * @returns {Record<string, string>} every string it holds, keyed by position.
 */
function strings(document) {
  const found = { title: document.title, lede: document.lede }
  document.sections.forEach((section, i) => {
    found[`s${i}.h`] = section.h
    section.blocks.forEach((block, j) => {
      if (block.ul === undefined) found[`s${i}.b${j}`] = block.p
      else block.ul.forEach((item, k) => { found[`s${i}.b${j}.i${k}`] = item })
    })
  })
  return found
}

/**
 * Whether the two languages of one document still hold the same strings.
 *
 * @param {string} slug - which document.
 * @returns {string[]} the keys one language has and the other does not.
 */
export function sameShape(slug) {
  const zh = Object.keys(strings(DOCUMENTS[slug]))
  const en = Object.keys(strings(ENGLISH[slug]))
  return [
    ...zh.filter((key) => !en.includes(key)).map((key) => `${slug}.${key}: missing from the English`),
    ...en.filter((key) => !zh.includes(key)).map((key) => `${slug}.${key}: missing from the Chinese`),
  ]
}

/** The slugs, in the order they are linked in. @type {string[]} */
export const POLICY_SLUGS = Object.keys(DOCUMENTS)

/**
 * The three documents as links, for a footer or a consent line.
 *
 * One place, so that a document renamed here is renamed everywhere it is
 * referred to — a consent line naming a document that no longer goes by that
 * name is the kind of thing nobody notices and a regulator does.
 *
 * Always a new tab. Every one of these sits beside something a person is in the
 * middle of — a half-filled sign-in form, a profile they have just edited, the
 * page they were reading — and a document they opened to check one clause is
 * not a reason to lose it. The documents link to each other in place, because
 * there you are already reading rather than doing.
 *
 * @param {object} [options] - how to render them.
 * @param {string} [options.separator] - what goes between them; nothing by default, since the titles carry their own brackets.
 * @returns {string} the markup.
 */
export function policyLinks(options = {}) {
  const { separator = '', lang = 'zh' } = options
  const target = ' target="_blank" rel="noopener"'
  // The brackets are the Chinese convention for a title and are not punctuation
  // English uses, so they belong to the language rather than to the markup.
  const name = (slug) => (lang === 'en' ? ENGLISH[slug].title : `《${DOCUMENTS[slug].title}》`)
  return POLICY_SLUGS
    .map((slug) => `<a href="/policy/${slug}"${target}>${name(slug)}</a>`)
    .join(separator)
}

/**
 * Render one document.
 *
 * The same chrome as the rest of the gateway's pages — ground, palette, faces —
 * because a policy page that looks like it came from somewhere else is a policy
 * page people do not believe. One reading column, no card: this is a document,
 * not a form.
 *
 * @param {string} slug - which document; must be one of POLICY_SLUGS.
 * @param {object} [state] - what to show.
 * @param {string} [state.contact] - the address to reach the operator at; the contact section is omitted when the deployment has not named one.
 * @param {string} [state.version] - the dsh release this deployment runs.
 * @returns {string} the HTML document.
 */
export function policyPage(slug, state = {}) {
  const { contact, version } = state
  const document = DOCUMENTS[slug]
  const release = version === undefined || version === '' ? '' : ` · v${escapeHtml(version)}`

  // `data-t`, not `data-th`: these blocks are prose and carry no markup, and
  // writing them through textContent means a document can never become a way to
  // put an element on this page.
  const sections = document.sections.map((section, i) => {
    const blocks = section.blocks.map((block, j) => (block.ul === undefined
      ? `<p data-t="s${i}.b${j}">${block.p}</p>`
      : `<ul>${block.ul.map((item, k) => `<li data-t="s${i}.b${j}.i${k}">${item}</li>`).join('')}</ul>`)).join('\n      ')
    return `<section>
      <h2 data-t="s${i}.h">${section.h}</h2>
      ${blocks}
    </section>`
  }).join('\n\n    ')

  // Only rendered when the deployment named an address. A contact section that
  // says "联系运营者" and gives no way to is worse than none: it reads as an
  // answer to a question it has not answered.
  const reach = contact === undefined || contact === ''
    ? ''
    : `<section>
      <h2 data-t="contact.h">联系方式</h2>
      <p data-th="contact.p">关于本文档、你的数据或违规举报，请联系 <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a>。</p>
    </section>`

  // The other two, so a reader who arrived at one of them can reach the rest
  // without going back through the form that sent them.
  const siblings = POLICY_SLUGS.filter((other) => other !== slug)
    .map((other) => `<a href="/policy/${other}" data-t="link.${other}">《${DOCUMENTS[other].title}》</a>`)
    .join('')

  // Everything this page says, in both languages: the document itself, keyed by
  // position, and the chrome around it, keyed by name.
  const zh = strings(document)
  const en = strings(ENGLISH[slug])
  const table = {}
  for (const key of Object.keys(zh)) table[key] = { zh: zh[key], en: en[key] ?? zh[key] }
  table['doc.title'] = { zh: `${document.title} · HamsterHQ`, en: `${ENGLISH[slug].title} · HamsterHQ` }
  table.stamp = { zh: `版本 ${POLICY_VERSION}`, en: `Version ${POLICY_VERSION}` }
  // Said on the page, not only in the source. Two texts of a promise are two
  // promises unless one of them is named as the one that counts, and the
  // consent recorded against an account is against the Chinese.
  table.prevail = {
    zh: '本文档以中文版为准，英文版仅供参考。',
    en: 'The Chinese text governs; this English version is provided for reference.',
  }
  table['contact.h'] = { zh: '联系方式', en: 'Contact' }
  table['contact.p'] = {
    zh: `关于本文档、你的数据或违规举报，请联系 <a href="mailto:${escapeHtml(contact ?? '')}">${escapeHtml(contact ?? '')}</a>。`,
    en: `For anything about this document, your data, or a report of abuse, contact <a href="mailto:${escapeHtml(contact ?? '')}">${escapeHtml(contact ?? '')}</a>.`,
  }
  // The siblings only: a document does not link to itself, and a key nothing
  // names is a string nobody maintains.
  for (const other of POLICY_SLUGS.filter((each) => each !== slug)) {
    table[`link.${other}`] = { zh: `《${DOCUMENTS[other].title}》`, en: ENGLISH[other].title }
  }
  table.back = { zh: '返回登录', en: 'Back to sign-in' }
  table.footer = { zh: 'HamsterHQ · 自建部署', en: 'HamsterHQ · self-hosted' }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${document.title} · HamsterHQ</title>
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${asset('favicon.svg')}">
${FONT_PRELOAD}
<style>
${PALETTE_CSS}
${BRAND_CSS}
${GROUND_CSS}
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    color: var(--fg);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.75;
    -webkit-font-smoothing: antialiased;
  }
  main { flex: 1; width: 100%; max-width: 46rem; margin: 0 auto; padding: 4.5rem 1.25rem 3rem; }

  /* No underline here, because the rule below underlines every link in the
     document, and this one is a wordmark: it drew a rule across the mark and
     out past the end of the word. */
  .brand { display: flex; align-items: center; gap: .5rem; margin-bottom: 2.5rem; text-decoration: none; color: inherit; border-bottom: 0; }
  .brand img { height: 22px; width: auto; display: block; }

  /* The paper the document sits on, on the same recipe as the sign-in card:
     a reading column laid over the lattice rather than floating in it. */
  article {
    padding: clamp(28px, 5vw, 56px);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-panel);
    background: var(--panel);
    box-shadow: var(--lift);
  }

  h1 { font-family: var(--display); margin: 0 0 .35rem; font-size: 1.75rem; font-weight: 600; letter-spacing: -.03em; }
  .stamp { margin: 0 0 1.75rem; font-family: var(--mono); font-size: 12px; color: var(--faint); }
  .lede { margin: 0 0 2.25rem; color: var(--muted); font-size: .9375rem; }

  h2 { margin: 2.25rem 0 .75rem; font-size: 1rem; font-weight: 600; letter-spacing: -.01em; }
  section:first-of-type h2 { margin-top: 0; }
  p { margin: 0 0 .875rem; color: var(--muted); }
  ul { margin: 0 0 .875rem; padding: 0; list-style: none; }
  /* The dash is drawn rather than typed, so a wrapped line indents under the
     text and not under the mark, the way the landing page's lists do. */
  li { position: relative; padding-left: 1.125rem; margin-bottom: .375rem; color: var(--muted); }
  li::before { content: ""; position: absolute; left: 0; top: .85em; width: 8px; height: 1px; background: var(--accent); }
  a { color: var(--fg); text-decoration: none; border-bottom: 1px solid var(--line-strong); }
  a:hover { border-color: var(--accent); }

  .also {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--line-soft);
    font-size: .875rem;
  }
  .also a { border-bottom: 0; color: var(--muted); }
  .also a:hover { color: var(--fg); }

  footer { padding: 1.5rem; text-align: center; font-family: var(--mono); font-size: 12px; color: var(--faint); }
  footer a { color: inherit; border-bottom: 0; }
  footer a:hover { color: var(--muted); }
</style>
</head>
<body>
${THEME_TOGGLE}
${langToggle(table)}
${GROUND_HTML}
<main>
  <a class="brand" href="/">
    <img src="${asset('hamster.svg')}" alt="">
    ${WORDMARK}
  </a>

  <article>
    <h1 data-t="title">${document.title}</h1>
    <p class="stamp" data-t="stamp">版本 ${POLICY_VERSION}</p>
    <p class="stamp" data-t="prevail">本文档以中文版为准，英文版仅供参考。</p>
    <p class="lede" data-t="lede">${document.lede}</p>

    ${sections}

    ${reach}

    <div class="also">${siblings}<a href="/login" data-t="back">返回登录</a></div>
  </article>
</main>
<footer><span data-t="footer">HamsterHQ · 自建部署</span>${release}</footer>
${GROUND_SCRIPT}
</body>
</html>
`
}
