# HuaOvO 管理后台重设计

目标：交付完整管理后台；所有控件有真实保存路径，前台直接读取配置。用户已经授权整体设计与实施，完成验收后交付。

视觉方向：沿用前台冷灰、主题强调色和字体，去除 Decap 外观补丁；固定侧栏 + 紧凑顶栏 + 可阅读的内容工作区，文章编辑用右侧检查器。浅深色、手机、键盘均可用。

任务与验收：
1. 内容存储：Markdown 为正文源；本地独立草稿目录，发布移动到 posts；生产使用 GitHub 分支与 PR，检查通过后合并。并发版本冲突不能覆盖。媒体真实上传，使用中的图片不得删除。测试路径、鉴权、版本和发布流程。
2. 前台配置：src/data/site.json 为唯一数据源，包含 identity/home/navigation/appearance/about/friends/footer。前台全部接入，修改配置能实际体现。校验链接、数量和必填项。
3. 管理后台：概览、文章/草稿、分类与标签、媒体、站点配置、发布与连接。自己的组件和主题，不嵌入旧 CMS。文章富文本使用 Milkdown，支持 Markdown、公式、代码、图片和前台样式预览。未保存离开提醒、本地恢复、操作反馈与错误处理。
4. 验收：Node 测试、Astro check、生产构建；浏览器操作保存草稿→发布、修改配置→前台验证、图片上传与引用、明暗切换、桌面与手机，无白块或溢出。删除验收临时内容，保留截图证据。

存储接口（src/admin/repository.js）：createRepository(config) 返回 load/savePost/deletePost/saveSettings/uploadMedia/deleteMedia/publishRelease。load 返回 {posts,settings,media,releases,connection}。Post {slug,status,data,body,revision?}；Media {path,url,name,size,revision?}；Release {id,title,url,state,branch,sha?}；保存方法返回 {post?,release?,settings?,media?}，发布主分支前不声称已上线。本地保存配置立即生效；生产保存配置创建发布 PR。

目录职责分开：存储代理负责 scripts/content-server.mjs、src/admin/repository.js、src/admin/content-model.js、src/admin/settings-model.js、对应测试；前台配置代理负责 site.ts、前台布局组件和页面；主代理负责 admin 页面/样式/脚本/编辑器与依赖、集成验证。
