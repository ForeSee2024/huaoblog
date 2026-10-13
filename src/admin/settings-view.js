import {
  escape as e,
  button,
  field,
  toggle,
  section,
  safeImage,
} from "./ui.js";
import { pageHeading } from "./views.js";
const socialIcons = [
  ["link", "网址"],
  ["github", "GitHub"],
  ["gitlab", "GitLab"],
  ["bilibili", "哔哩哔哩"],
  ["x-twitter", "X / Twitter"],
  ["weibo", "微博"],
  ["linkedin", "LinkedIn"],
  ["discord", "Discord"],
];
const grid = (content) => `<div class="form-grid">${content}</div>`;
const f = field;

export function settingsPreview(settings, image = (value) => value) {
  const { identity, home } = settings;
  return `<p>首页实时预览</p><div class="mini-home"><div class="mini-home-header"><img data-preview-path="${e(identity.avatar)}" src="${e(safeImage(image(identity.avatar)) || "/favicon.svg")}" alt="" /><span>${e(identity.brand)}</span></div><div class="mini-home-body"><small>${e(home.eyebrow)}</small><h3>${e(home.title)}</h3><p>${e(home.intro)}</p><span class="mini-home-button">${e(home.primaryLabel)}</span></div>${home.announcementEnabled ? `<div class="mini-home-announcement">${e(home.announcementTitle)} · ${e(home.announcement)}</div>` : ""}</div><p class="preview-caption">预览显示当前编辑内容。${settings.revision ? "保存后更新前台配置。" : "保存配置后，前台会使用这些设定。"}</p>`;
}
export function settingsView(settings, tab, local, image) {
  const tabs = [
    ["general", "站点信息"],
    ["home", "首页与导航"],
    ["appearance", "外观主题"],
    ["about", "关于页面"],
    ["friends", "友情链接"],
    ["footer", "页脚设置"],
  ];
  let content = "";
  if (tab === "general") {
    content =
      section(
        "站点与作者",
        "品牌、个人资料，以及搜索与分享时显示的信息。",
        grid(
          f("品牌名称", "identity.brand", settings.identity.brand, {
            required: true,
            max: 40,
          }) +
            f("作者名称", "identity.author", settings.identity.author, {
              required: true,
              max: 100,
            }) +
            f("站点标题", "identity.name", settings.identity.name, {
              wide: true,
              required: true,
              max: 100,
              hint: "用于网页标题和分享信息。",
            }) +
            f(
              "站点描述",
              "identity.description",
              settings.identity.description,
              {
                wide: true,
                required: true,
                type: "textarea",
                max: 300,
                hint: "用于搜索摘要和站点简介。",
              },
            ) +
            f("头像图片", "identity.avatar", settings.identity.avatar, {
              wide: true,
              hint: "站内图片路径或完整图片地址。",
            }) +
            `<div class="field-wide">${button("从媒体库选择头像", "pick-avatar", "image", "secondary")}</div>` +
            f("身份标签", "identity.tagline", settings.identity.tagline, {
              wide: true,
              max: 160,
            }) +
            f("个人简介", "identity.bio", settings.identity.bio, {
              wide: true,
              type: "textarea",
              max: 1000,
            }),
        ),
      ) +
      section(
        "社交链接",
        "显示在前台个人名片中。",
        settings.identity.socialLinks
          .map(
            (link, index) =>
              `<div class="repeater-row"><div class="repeater-bar"><strong>链接 ${index + 1}</strong>${button("移除", "remove-social", "delete", "quiet", `data-index="${index}"`)}</div>${grid(f("名称", `identity.socialLinks.${index}.label`, link.label, { required: true, max: 80 }) + f("图标", `identity.socialLinks.${index}.icon`, link.icon || "link", { choices: socialIcons }) + f("网址", `identity.socialLinks.${index}.url`, link.url, { wide: true, type: "url", required: true, placeholder: "https://…" }))}</div>`,
          )
          .join("") + button("添加社交链接", "add-social", "plus", "secondary"),
      );
  } else if (tab === "home") {
    content =
      section(
        "首页内容",
        "调整访客打开博客时看到的文案。",
        grid(
          f("眉题", "home.eyebrow", settings.home.eyebrow, {
            wide: true,
            max: 100,
          }) +
            f("首页标题", "home.title", settings.home.title, {
              wide: true,
              type: "textarea",
              rows: 2,
              required: true,
              max: 240,
              hint: "回车可以设置标题换行。",
            }) +
            f("首页介绍", "home.intro", settings.home.intro, {
              wide: true,
              type: "textarea",
              max: 1500,
            }) +
            f("文章按钮文字", "home.primaryLabel", settings.home.primaryLabel, {
              required: true,
              max: 40,
            }) +
            f(
              "关于按钮文字",
              "home.secondaryLabel",
              settings.home.secondaryLabel,
              { required: true, max: 40 },
            ) +
            f("文章列表标题", "home.feedTitle", settings.home.feedTitle, {
              wide: true,
              required: true,
              max: 100,
            }) +
            f("首页文章数量", "home.postsPerPage", settings.home.postsPerPage, {
              type: "number",
              min: 3,
              maxValue: 24,
              hint: "首页显示 3–24 篇，其余内容在博文列表中浏览。",
            }),
        ),
      ) +
      section(
        "站点公告",
        "在首页介绍下方显示简短通知。",
        toggle(
          "显示首页公告",
          "home.announcementEnabled",
          settings.home.announcementEnabled,
        ) +
          grid(
            f(
              "公告标题",
              "home.announcementTitle",
              settings.home.announcementTitle,
              { max: 100 },
            ) +
              f("公告内容", "home.announcement", settings.home.announcement, {
                wide: true,
                type: "textarea",
                max: 1500,
              }),
          ),
      ) +
      section(
        "顶部导航",
        "设置显示名称、顺序与可见性。",
        settings.navigation
          .map(
            (item, index) =>
              `<div class="nav-config-row">${f("名称", `navigation.${index}.label`, item.label, { required: true, max: 40 })}${f("链接", `navigation.${index}.href`, item.href, { required: true })}${toggle("显示", `navigation.${index}.enabled`, item.enabled)}<div class="nav-config-order"><button type="button" class="icon-button" data-action="move-nav" data-index="${index}" data-direction="-1" aria-label="上移 ${e(item.label)}" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" class="icon-button" data-action="move-nav" data-index="${index}" data-direction="1" aria-label="下移 ${e(item.label)}" ${index === settings.navigation.length - 1 ? "disabled" : ""}>↓</button></div></div>`,
          )
          .join("") +
          `<p class="field-hint" style="margin-top:14px">支持已有站内页面和 HTTPS 外部链接。至少保留一项导航。</p>`,
      );
  } else if (tab === "appearance") {
    content = section(
      "默认主题",
      "访客第一次打开站点时使用的外观。",
      grid(
        f("明暗模式", "appearance.theme", settings.appearance.theme, {
          wide: true,
          choices: [
            ["system", "跟随系统"],
            ["light", "浅色模式"],
            ["dark", "深色模式"],
          ],
          hint: "访客手动选择的主题优先于站点默认主题。",
        }),
      ) +
        `<div class="field" style="margin-top:24px"><label>主题强调色</label><div class="accent-options">${[
          ["cyberblue", "科技蓝", "#38bdf8"],
          ["neoncyan", "极客青", "#34d399"],
          ["violet", "紫罗兰", "#818cf8"],
          ["lumine", "琥珀金", "#fbbf24"],
        ]
          .map(
            ([value, label, color]) =>
              `<button type="button" class="accent-option" data-action="select-accent" data-accent="${value}" aria-pressed="${settings.appearance.accent === value}"><span style="--swatch:${color}"></span>${label}</button>`,
          )
          .join("")}</div></div>` +
        toggle(
          "动态背景",
          "appearance.backgroundEffect",
          settings.appearance.backgroundEffect,
          "启用前台的拓扑波浪背景。减少动态效果的访客会自动停用动画。",
        ),
    );
  } else if (tab === "about") {
    content = section(
      "关于页面",
      "介绍你自己，以及这个博客的记录方向。",
      grid(
        f("页面标题", "about.title", settings.about.title, {
          wide: true,
          required: true,
          max: 200,
        }) +
          f("副标题", "about.subtitle", settings.about.subtitle, {
            wide: true,
            max: 300,
          }) +
          f("正文", "about.body", settings.about.body, {
            wide: true,
            type: "textarea",
            rows: 12,
            max: 30000,
            hint: "支持 Markdown 标题、段落、列表与链接。",
          }),
      ),
    );
  } else if (tab === "friends") {
    content = section(
      "友情链接",
      "添加朋友的博客或值得长期阅读的网站。",
      settings.friends
        .map(
          (friend, index) =>
            `<div class="repeater-row"><div class="repeater-bar"><strong>友链 ${index + 1}</strong>${button("移除", "remove-friend", "delete", "quiet", `data-index="${index}"`)}</div>${grid(f("名称", `friends.${index}.name`, friend.name, { required: true, max: 100 }) + f("网址", `friends.${index}.url`, friend.url, { required: true, type: "url", placeholder: "https://…" }) + f("简介", `friends.${index}.description`, friend.description, { wide: true, type: "textarea", rows: 2, max: 300 }) + f("头像地址", `friends.${index}.avatar`, friend.avatar || "", { wide: true }))}</div>`,
        )
        .join("") +
        (!settings.friends.length
          ? '<p class="section-copy" style="margin-bottom:20px">还没有添加友链。添加后会显示在前台的“友链”页面。</p>'
          : "") +
        button("添加友链", "add-friend", "plus", "secondary"),
    );
  } else if (tab === "footer") {
    content = section(
      "页脚与备案",
      "设置站点底部的文案和备案信息。",
      grid(
        f("页脚文案", "footer.text", settings.footer.text, {
          wide: true,
          max: 300,
        }) +
          f("备案号", "footer.icp", settings.footer.icp, {
            wide: true,
            max: 100,
            placeholder: "没有备案信息时留空",
          }) +
          f("备案查询地址", "footer.icpUrl", settings.footer.icpUrl, {
            wide: true,
            type: "url",
          }),
      ),
    );
  }
  return `${pageHeading("站点配置", "前台内容与外观，在这里统一维护。")}<div class="settings-tabs">${tabs.map(([id, label]) => `<a href="#/settings/${id}" class="${id === tab ? "active" : ""}" ${id === tab ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</div><form id="settings-form"><div class="settings-layout"><div>${content}<div class="save-bar"><p id="settings-save-state">${local ? "保存后更新本地前台。" : "保存后创建待发布变更。"}</p>${button("保存配置", "save-settings", "save", "primary")}</div></div><aside id="settings-preview" class="settings-preview">${settingsPreview(settings, image)}</aside></div></form>`;
}
